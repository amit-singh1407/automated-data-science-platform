from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pandas as pd

from app.core.config import settings
from app.db.database import initialize_database
from app.services.cleaning import apply_ecp_rules, apply_general_cleaning_rules
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
        (progress, message, pd.Timestamp.utcnow().isoformat(), job_id),
    )
    db.commit()


def _build_visualizations(profile: dict, cleaning: dict, ml: dict) -> dict:
    missing_items = [{"column": key, "missing": value} for key, value in profile["missing_values"].items()]
    visuals = {
        "missing_values_bar": {
            "type": "bar",
            "x": [item["column"] for item in missing_items],
            "y": [item["missing"] for item in missing_items],
        },
        "quality_gauge": {"type": "gauge", "value": profile["quality_score"], "max": 100},
        "quality_comparison": {
            "before": cleaning["before_after_quality"]["before"],
            "after": cleaning["before_after_quality"]["after"],
            "change": cleaning["before_after_quality"]["change"],
        },
        "outlier_bar": {
            "type": "bar",
            "x": list(profile.get("unusual_numeric_values", {}).keys()),
            "y": list(profile.get("unusual_numeric_values", {}).values()),
        },
        "cleaning_summary": {
            "type": "pie",
            "labels": ["ECP Rules", "General Rules", "Uncertain"],
            "values": [
                len([a for a in cleaning["audit_log"] if a["rule_set"] == "ecp"]),
                len([a for a in cleaning["audit_log"] if a["rule_set"] == "general"]),
                len(cleaning["uncertain_cases"]),
            ],
        },
        "ml_summary": ml,
    }
    return visuals


def _job_artifact_paths(job_id: str, original_path: Path) -> dict[str, Path]:
    extension = original_path.suffix.lower()
    output_extension = ".xlsx" if extension == ".xls" else extension
    job_dir = settings.uploads_dir / job_id
    return {
        "original": original_path,
        "cleaned": job_dir / f"cleaned{output_extension}",
        "transformed": job_dir / f"transformed{output_extension}",
        "report": job_dir / "report.pdf",
        "log": job_dir / "audit-log.json",
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
            (job_id, fingerprint, original_path.stat().st_size, pd.Timestamp.utcnow().isoformat()),
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

        with measure_stage("cleaning", len(df)) as measurement:
            ecp_df, ecp_audit, ecp_uncertain = apply_ecp_rules(df)
            clean_df, gen_audit, gen_uncertain = apply_general_cleaning_rules(ecp_df)
            cleaned_profile = build_profile(clean_df)
        stages.append(measurement)
        _update_progress(db, job_id, 45, "Applying cleaning rules")
        cleaning_result = {
            "audit_log": ecp_audit + gen_audit,
            "uncertain_cases": ecp_uncertain + gen_uncertain,
            "ecp_summary": {"rules_applied": len(ecp_audit)},
            "general_summary": {"rules_applied": len(gen_audit)},
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
        visualizations = _build_visualizations(profile, cleaning_result, ml_result)

        with measure_stage("artifacts", len(transformed_df)) as measurement:
            save_dataframe(clean_df, artifacts["cleaned"])
            save_dataframe(transformed_df, artifacts["transformed"])
            artifacts["log"].write_text(json.dumps(cleaning_result["audit_log"], indent=2), encoding="utf-8")
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
                json.dumps(cleaning_result["audit_log"] + [{"rule_set": "system", **audit_metadata}]),
                "completed", None,
                pd.Timestamp.utcnow().isoformat(), job_id,
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
                ("failed", str(exc), pd.Timestamp.utcnow().isoformat(), job_id),
            )
            db.commit()
    finally:
        db.close()
