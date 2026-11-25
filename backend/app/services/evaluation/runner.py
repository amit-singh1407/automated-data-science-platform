"""Run the evaluation: inject errors at each rate and seed, run every method,
score it, and summarise (mean over seeds)."""
from __future__ import annotations

from time import perf_counter
from typing import Callable, Iterable

import pandas as pd

from .inject import build_reference, inject_errors
from .methods import METHODS
from .metrics import score

SUMMARY_FIELDS = (
    "repair_precision", "repair_recall", "repair_f1",
    "detection_precision", "detection_recall", "detection_f1",
    "rows_kept", "clean_cells_damaged", "invoices_within_1pct", "seconds",
)


def run_evaluation(
    raw: pd.DataFrame,
    rates: Iterable[float] = (0.10,),
    seeds: Iterable[int] = (0,),
    methods: Iterable[str] | None = None,
    progress: Callable[[str], None] = print,
    reference: pd.DataFrame | None = None,
) -> dict:
    names = list(methods) if methods else list(METHODS)
    unknown = [name for name in names if name not in METHODS]
    if unknown:
        raise ValueError(f"Unknown methods: {unknown}. Choose from: {list(METHODS)}")
    if reference is None:
        progress("Building the clean reference with ECP…")
        reference, info = build_reference(raw)
    else:
        info = {"rows": len(reference), "rule": "supplied by caller"}
    progress(f"Reference: {info['rows']:,} rows")

    runs: list[dict] = []
    for rate in rates:
        for seed in seeds:
            corrupted = inject_errors(reference, rate, seed)
            progress(f"rate {rate:.0%}, seed {seed}: {len(corrupted.frame):,} rows with errors")
            for name in names:
                started = perf_counter()
                output = METHODS[name](corrupted.frame, seed)
                seconds = perf_counter() - started
                result = score(reference, corrupted, output)
                result.update(method=name, rate=rate, seed=seed, seconds=round(seconds, 2))
                runs.append(result)
                f1 = result["repair_f1"]
                progress(f"  {name:<42} repair F1 {'—' if f1 is None else f'{f1:.3f}'}  ({seconds:.1f}s)")
    return {"reference": info, "runs": runs, "summary": summarise(runs)}


def summarise(runs: list[dict]) -> list[dict]:
    frame = pd.DataFrame(runs)
    rows = []
    for (method, rate), group in frame.groupby(["method", "rate"], sort=False):
        entry = {"method": method, "rate": rate, "seeds": int(len(group))}
        for field in SUMMARY_FIELDS:
            values = pd.to_numeric(group[field], errors="coerce").dropna()
            entry[field] = float(values.mean()) if len(values) else None
            if field == "repair_f1" and len(values) > 1:
                entry["repair_f1_std"] = float(values.std())
        by_type = pd.DataFrame(list(group["recall_by_type"])).mean().to_dict()
        entry["recall_by_type"] = {k: (None if pd.isna(v) else float(v)) for k, v in by_type.items()}
        rows.append(entry)
    return rows


def _fmt(value: float | None, digits: int = 3, percent: bool = False) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.1f}%" if percent else f"{value:.{digits}f}"


def markdown_table(summary: list[dict]) -> str:
    lines = [
        "| Method | Rate | Repair P | Repair R | Repair F1 | Detect F1 | Rows kept | Clean cells damaged | Invoices within 1% | Time (s) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for s in summary:
        lines.append(
            f"| {s['method']} | {s['rate']:.0%} | {_fmt(s['repair_precision'])} | {_fmt(s['repair_recall'])} "
            f"| {_fmt(s['repair_f1'])} | {_fmt(s['detection_f1'])} | {_fmt(s['rows_kept'], percent=True)} "
            f"| {s['clean_cells_damaged']:.0f} | {_fmt(s['invoices_within_1pct'], percent=True)} | {s['seconds']:.1f} |"
        )
    return "\n".join(lines)


def markdown_by_type(summary: list[dict], method: str = "ECP") -> str:
    rows = [s for s in summary if s["method"] == method]
    if not rows:
        return ""
    types = list(rows[0]["recall_by_type"])
    lines = ["| Error type | " + " | ".join(f"{s['rate']:.0%}" for s in rows) + " |",
             "|---|" + "---|" * len(rows)]
    for t in types:
        lines.append(f"| {t} | " + " | ".join(_fmt(s["recall_by_type"].get(t), percent=True) for s in rows) + " |")
    return "\n".join(lines)
