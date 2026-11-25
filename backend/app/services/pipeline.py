from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

from app.core.config import settings
from app.db.database import initialize_database
from app.services.ecp import run_ecp
from app.services.file_storage import load_dataframe, save_dataframe
from app.services.ml import run_automl
from app.services.profiling import build_profile
from app.services.performance import fingerprint_file, measure_stage, runtime_metadata
from app.services.profile_cache import get_cached_profile, store_profile
from app.services.reporting import write_pdf_report
from app.services.transformation import transform_features


def _update_progress(db: sqlite3.Connection, job_id: str, progress: int, message: str) -> None:
    db.execute(
        "UPDATE jobs SET progress = ?, progress_message = ?, updated_at = ? WHERE id = ?",
        (progress, message, pd.Timestamp.now("UTC").isoformat(), job_id),
    )
    db.commit()


MAX_CHART_COLUMNS = 12


def _numeric_columns(df: pd.DataFrame) -> list:
    numeric = df.select_dtypes(include="number")
    varying = [column for column in numeric.columns if numeric[column].nunique(dropna=True) > 1]
    return varying[:MAX_CHART_COLUMNS]


def _correlation(df: pd.DataFrame) -> dict | None:
    columns = _numeric_columns(df)
    if len(columns) < 2:
        return None
    matrix = df[columns].astype("float64").corr().round(3)
    return {
        "columns": [str(c) for c in columns],
        "matrix": [[None if pd.isna(v) else float(v) for v in row] for row in matrix.to_numpy()],
    }


def _distributions(df: pd.DataFrame, bins: int = 20) -> dict:
    """Histogram per numeric column. Values outside the 1st-99th percentile
    are left out (and counted) so one extreme value does not flatten the chart."""
    result: dict = {}
    for column in _numeric_columns(df):
        values = df[column].astype("float64").replace([np.inf, -np.inf], np.nan).dropna()
        if values.empty:
            continue
        low, high = values.quantile([0.01, 0.99])
        if low == high:
            low, high = values.min(), values.max()
        inside = values[(values >= low) & (values <= high)]
        counts, edges = np.histogram(inside, bins=bins)
        result[str(column)] = {
            "edges": [round(float(e), 6) for e in edges],
            "counts": [int(c) for c in counts],
            "excluded_extremes": int(len(values) - len(inside)),
        }
    return result


def _build_visualizations(profile: dict, cleaned_profile: dict, cleaning: dict, clean_df: pd.DataFrame) -> dict:
    missing_before = profile["missing_values"]
    missing_after = cleaned_profile["missing_values"]
    return {
        "missing_values": {
            "columns": list(missing_before),
            "before": [missing_before[c] for c in missing_before],
            "after": [missing_after.get(c, 0) for c in missing_before],
            "rows_before": profile["rows"],
            "rows_after": cleaned_profile["rows"],
        },
        "quality_comparison": {
            "before": cleaning["before_after_quality"]["before"],
            "after": cleaning["before_after_quality"]["after"],
            "change": cleaning["before_after_quality"]["change"],
        },
        "unusual_values": {
            "method": "IQR rule on the uploaded data (1.5 x IQR), whole column at once",
            "columns": list(profile.get("unusual_numeric_values", {})),
            "counts": list(profile.get("unusual_numeric_values", {}).values()),
        },
        "cleaning_summary": {
            "labels": [f"{stage['stage']} {stage['name']}" for stage in cleaning["stages"]],
            "cells_changed": [stage.get("cells_changed", 0) for stage in cleaning["stages"]],
            "rows_moved_or_removed": [stage.get("rows_moved_or_removed", 0) for stage in cleaning["stages"]],
            "rows_flagged": [stage.get("rows_flagged", 0) for stage in cleaning["stages"]],
        },
        "correlation": _correlation(clean_df),
        "distributions": _distributions(clean_df),
    }


def _job_artifact_paths(job_id: str, original_path: Path) -> dict[str, Path]:
    extension = original_path.suffix.lower()
    output_extension = ".xlsx" if extension == ".xls" else extension
    job_dir = settings.uploads_dir / job_id
    return {
        "original": original_path,
        "cleaned": job_dir / f"cleaned{output_extension}",
        "transformed": job_dir / f"transformed{output_extension}",
        "report": job_dir / "report.pdf",
        "log": job_dir / "audit-log.csv",
        "review": job_dir / "review.csv",
    }


def process_job(job_id: str) -> None:
    initialize_database()
    db = sqlite3.connect(settings.database_path)
    db.row_factory = sqlite3.Row
    try:
        job = db.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not job:
            return

        db.execute("UPDATE jobs SET status = ? WHERE id = ?", ("processing", job_id))
        db.commit()
        _update_progress(db, job_id, 10, "Loading dataset")

        job_dir = settings.uploads_dir / job_id
        original_candidates = [p for p in job_dir.iterdir() if p.name.startswith("original")]
        if not original_candidates:
            raise FileNotFoundError("Original upload not found.")
        original_path = original_candidates[0]
        artifacts = _job_artifact_paths(job_id, original_path)

        fingerprint = fingerprint_file(original_path)
        db.execute(
            "INSERT OR REPLACE INTO dataset_fingerprints "
            "(job_id, content_hash, file_size_bytes, created_at) VALUES (?, ?, ?, ?)",
            (job_id, fingerprint, original_path.stat().st_size, pd.Timestamp.now("UTC").isoformat()),
        )
        db.commit()
        stages: list[dict[str, object]] = []
        with measure_stage("loading", 0) as measurement:
            df = load_dataframe(original_path)
        stages.append(measurement)
        with measure_stage("profiling", len(df)) as measurement:
            profile = get_cached_profile(db, fingerprint)
            profile_cache_hit = profile is not None
            if profile is None:
                profile = build_profile(df)
                store_profile(db, fingerprint, profile)
        stages.append(measurement)
        db.execute(
            "UPDATE dataset_fingerprints SET row_count = ?, column_count = ? WHERE job_id = ?",
            (len(df), len(df.columns), job_id),
        )
        _update_progress(db, job_id, 25, "Profiling dataset")

        _update_progress(db, job_id, 30, "Cleaning with ECP (S1-S7)")
        with measure_stage("cleaning", len(df)) as measurement:
            ecp = run_ecp(df)
            clean_df = ecp.cleaned
            cleaned_profile = build_profile(clean_df)
        stages.append(measurement)
        _update_progress(db, job_id, 45, "ECP cleaning complete")
        summary = ecp.summary
        general_changes = next(
            (stage.get("cells_changed", 0) for stage in summary["stages"]
             if stage["stage"] == "S7" and summary["mode"] == "generic"),
            0,
        )
        cleaning_result = {
            **summary,
            # Kept for the current UI, which reads these keys.
            "audit_log": summary["audit_log_sample"],
            "ecp_summary": {"rules_applied": summary["cells_changed"] - general_changes},
            "general_summary": {"rules_applied": general_changes},
            "before_after_quality": {
                "before": profile["quality_score"],
                "after": cleaned_profile["quality_score"],
                "change": round(cleaned_profile["quality_score"] - profile["quality_score"], 2),
            },
        }

        with measure_stage("transformation", len(clean_df)) as measurement:
            target_column = next(
                (candidate for candidate in ("target", "label", "y") if candidate in clean_df.columns),
                None,
            )
            transformed_df, transform_details = transform_features(clean_df, target_column)
        stages.append(measurement)
        _update_progress(db, job_id, 60, "Transforming features")
        with measure_stage("analysis", len(transformed_df)) as measurement:
            ml_result = run_automl(transformed_df)
        stages.append(measurement)
        _update_progress(db, job_id, 75, "Running automated analysis")
        visualizations = _build_visualizations(profile, cleaned_profile, cleaning_result, clean_df)

        with measure_stage("artifacts", len(transformed_df)) as measurement:
            save_dataframe(clean_df, artifacts["cleaned"])
            save_dataframe(transformed_df, artifacts["transformed"])
            ecp.audit.to_csv(artifacts["log"], index=False)
            ecp.review.to_csv(artifacts["review"], index=False)
            for name, table in ecp.side_tables.items():
                table.to_csv(job_dir / f"side-{name}.csv", index=False)
            write_pdf_report(artifacts["report"], job_id, profile, cleaning_result, ml_result)
        stages.append(measurement)
        db.executemany(
            "INSERT INTO job_stages "
            "(job_id, stage, started_at, duration_ms, peak_memory_bytes, rows_processed) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                (job_id, item["stage"], item["started_at"], item["duration_ms"],
                 item["peak_memory_bytes"], item["rows_processed"])
                for item in stages
            ],
        )
        audit_metadata = {
            "pipeline_version": "1.1",
            "dataset_fingerprint": fingerprint,
            "profile_cache_hit": profile_cache_hit,
            "runtime": runtime_metadata(),
            "stages": stages,
        }
        _update_progress(db, job_id, 90, "Writing output artifacts")

        db.execute(
            """
            UPDATE jobs SET profile_json = ?, cleaning_json = ?, transform_json = ?,
                ml_json = ?, visualization_json = ?, audit_json = ?, status = ?,
                error_message = ?, updated_at = ? WHERE id = ?
            """,
            (
                json.dumps(profile), json.dumps(cleaning_result), json.dumps(transform_details),
                json.dumps(ml_result), json.dumps(visualizations),
                json.dumps(summary["audit_log_sample"] + [{"stage": "system", **audit_metadata}]),
                "completed", None,
                pd.Timestamp.now("UTC").isoformat(), job_id,
            ),
        )
        _update_progress(db, job_id, 100, "Completed")
        db.commit()
    except Exception as exc:
        # A background task must always transition to a terminal state. The
        # message is persisted for the authenticated job owner to diagnose.
        job = db.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if job:
            db.execute(
                "UPDATE jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
                ("failed", str(exc), pd.Timestamp.now("UTC").isoformat(), job_id),
            )
            db.commit()
    finally:
        db.close()
