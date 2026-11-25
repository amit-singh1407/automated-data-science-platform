"""Run the ECP pipeline and assemble its outputs."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any, Callable

import pandas as pd

from .audit import frame_records, jsonable
from .config import REQUIRED_ROLES, ECPConfig, detect_columns
from .stages import (
    ECPContext,
    _as_float,
    generic_fill,
    s1_profile,
    s2_standardise,
    s3_deduplicate,
    s4_shop_rules,
    s5_dependencies,
    s6_unusual_values,
    s7_fill_and_validate,
)

STAGE_NAMES = {
    "S1": "Profile",
    "S2": "Standardise",
    "S3": "Deduplicate",
    "S4": "Shop rules",
    "S5": "Dependencies",
    "S6": "Unusual values",
    "S7": "Fill and validate",
}
SIDE_TABLES = ("returns", "fees", "adjustments", "duplicates")

StageFn = Callable[[ECPContext], dict[str, Any]]


@dataclass
class ECPResult:
    cleaned: pd.DataFrame
    audit: pd.DataFrame
    review: pd.DataFrame
    side_tables: dict[str, pd.DataFrame]
    summary: dict[str, Any]
    # For each row of ``cleaned``: its 1-based row number in the input.
    cleaned_rows: pd.Index


def _plan(retail: bool, config: ECPConfig) -> list[tuple[str, StageFn | None]]:
    if retail:
        standardise_then_dedupe = [("S2", s2_standardise), ("S3", s3_deduplicate)]
        if not config.standardise_before_dedupe:
            standardise_then_dedupe.reverse()
        return [
            ("S1", s1_profile),
            *standardise_then_dedupe,
            ("S4", s4_shop_rules),
            ("S5", s5_dependencies),
            ("S6", s6_unusual_values),
            ("S7", s7_fill_and_validate),
        ]
    return [
        ("S1", lambda ctx: s1_profile(ctx, retail=False)),
        ("S2", lambda ctx: s2_standardise(ctx, retail=False)),
        ("S3", s3_deduplicate),
        ("S4", None),
        ("S5", None),
        ("S6", None),
        ("S7", generic_fill),
    ]


def _invoice_totals(ctx: ECPContext) -> dict[str, Any] | None:
    if ctx.baseline is None or ctx.work.empty:
        return None
    invoice, quantity, price = ctx.col("invoice"), ctx.col("quantity"), ctx.col("unit_price")
    rows = ctx.work.index
    invoices = ctx.work[invoice]
    before_lines = _as_float(ctx.baseline.loc[rows, quantity]) * _as_float(ctx.baseline.loc[rows, price])
    after_lines = _as_float(ctx.work[quantity]) * _as_float(ctx.work[price])
    before = before_lines.groupby(invoices).sum()
    after = after_lines.groupby(invoices).sum()
    changed = (after - before).abs() > (before.abs() * 0.01).clip(lower=0.005)
    return {
        "invoices": int(len(after)),
        "invoices_changed_over_1pct": int(changed.sum()),
        "sales_value_before": round(float(before.sum()), 2),
        "sales_value_after": round(float(after.sum()), 2),
        "value_added_by_price_fills": round(ctx.filled_price_revenue, 2),
        "note": (
            "Totals are for the rows kept as sales, before and after ECP. Accuracy against a "
            "known-correct total needs the evaluation set-up from the thesis (clean reference + "
            "injected errors)."
        ),
    }


def run_ecp(frame: pd.DataFrame, config: ECPConfig | None = None) -> ECPResult:
    config = config or ECPConfig()
    columns = detect_columns(frame.columns)
    retail = all(role in columns for role in REQUIRED_ROLES)
    ctx = ECPContext(frame, columns, config)
    rows_in = len(frame)

    stages: list[dict[str, Any]] = []
    stage_details: dict[str, Any] = {}
    for code, function in _plan(retail, config):
        entry: dict[str, Any] = {"stage": code, "name": STAGE_NAMES[code]}
        if function is None:
            entry.update(
                status="skipped",
                reason="Needs order columns (invoice, stock code, quantity, unit price), "
                "which this dataset does not have.",
            )
            stages.append(entry)
            continue
        rows_before = len(ctx.work)
        started = perf_counter()
        details = function(ctx)
        audit_counts = ctx.audit.counts.get(code, {})
        entry.update(
            status="completed",
            duration_ms=round((perf_counter() - started) * 1000, 3),
            rows_in=rows_before,
            rows_out=len(ctx.work),
            cells_changed=sum(n for action, n in audit_counts.items()
                              if not action.startswith("move_to_") and action != "remove_duplicate"),
            rows_moved_or_removed=rows_before - len(ctx.work),
            rows_flagged=ctx.review.total(code),
            actions=dict(audit_counts),
        )
        if code == "S7" and not retail:
            entry["name"] = "General fill and validate (not ECP)"
        stages.append(entry)
        stage_details[code] = details

    audit = ctx.audit.to_frame()
    review_flags = ctx.review.to_frame()
    cleaned_with_rows = ctx.work.reset_index()
    review = review_flags.merge(cleaned_with_rows, on="row", how="left", suffixes=("", "_data"))
    side_tables = {
        name: pd.concat(ctx.side_tables[name]).reset_index() for name in SIDE_TABLES if name in ctx.side_tables
    }
    cleaned_rows = ctx.work.index.copy()
    cleaned = ctx.work.reset_index(drop=True)

    per_stage = max(1, config.audit_sample_size // len(STAGE_NAMES))
    audit_sample = audit.groupby("stage", sort=False).head(per_stage) if len(audit) else audit
    uncertain = list(ctx.uncertain_columns)
    if len(review_flags):
        grouped = review_flags.groupby(["stage", "column", "issue"], sort=False)
        for (stage, column, issue), group in grouped:
            uncertain.append({
                "stage": stage, "column": column, "issue": issue,
                "rows": int(len(group)), "reason": group["reason"].iloc[0],
            })

    validation = stage_details.get("S7", {}).get("validation", [])
    summary: dict[str, Any] = {
        "engine": "ECP",
        "version": "1.0",
        "mode": "retail" if retail else "generic",
        "mode_reason": (
            "Order columns found; all seven ECP stages ran."
            if retail else
            "Order columns (invoice, stock code, quantity, unit price) not found; "
            "the order-specific stages S4-S6 were skipped."
        ),
        "column_mapping": {role: str(column) for role, column in columns.items()},
        "config": asdict(config),
        "stages": stages,
        "stage_details": jsonable(stage_details),
        "rows": {
            "input": rows_in,
            "sales_output": len(cleaned),
            "moved": {name: int(len(table)) for name, table in side_tables.items()},
            "flagged_for_review": int(review_flags["row"].nunique()) if len(review_flags) else 0,
        },
        "cells_changed": int(sum(stage.get("cells_changed", 0) for stage in stages)),
        "dependency_rules": jsonable(ctx.dependency_rules),
        "validation": jsonable(validation),
        "invoice_totals": _invoice_totals(ctx) if retail else None,
        "uncertain_cases": jsonable(uncertain),
        "audit_log_total": int(len(audit)),
        "audit_log_sample": frame_records(audit_sample),
        "review_total": int(len(review_flags)),
        "review_sample": frame_records(review.head(config.review_sample_size)),
    }
    return ECPResult(
        cleaned=cleaned, audit=audit, review=review, side_tables=side_tables, summary=summary,
        cleaned_rows=cleaned_rows,
    )
