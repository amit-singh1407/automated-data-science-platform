"""Scoring a cleaning method against the clean reference.

Units of work: every injected cell error and every injected duplicate row.

- Repair: an action is a changed cell or a removed row. It is correct if the
  cell now equals the reference, or the removed row was an injected
  duplicate. Repair precision = correct actions / actions; repair recall =
  units fixed / units.
- Detection: a unit counts as detected if its cell was changed or flagged, or
  its row was removed. Detection precision = detection actions that touch a
  unit / all detection actions (changed cells, flagged cells, removed rows).
- Rows kept: genuine (non-duplicate) input rows still present.
- Clean cells damaged: cells with no injected error that the method changed
  to a value different from the reference.
- Invoice accuracy: share of reference invoices whose cleaned total
  (quantity x price) is within 1% of the reference total.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.ecp import detect_columns

from .inject import CELL_ERRORS, ROW_ERRORS, Corrupted
from .methods import MethodOutput


def _equal(a: pd.Series, b: pd.Series) -> np.ndarray:
    """Element-wise equality; blanks equal blanks; numbers compared with a tolerance."""
    a = a.reset_index(drop=True)
    b = b.reset_index(drop=True)
    both_blank = (a.isna() & b.isna()).to_numpy()
    a_num = pd.to_numeric(a, errors="coerce") if not pd.api.types.is_datetime64_any_dtype(a) else None
    b_num = pd.to_numeric(b, errors="coerce") if not pd.api.types.is_datetime64_any_dtype(b) else None
    if (a_num is not None and b_num is not None
            and a_num.notna().sum() == a.notna().sum() and b_num.notna().sum() == b.notna().sum()
            and (pd.api.types.is_numeric_dtype(a) or pd.api.types.is_numeric_dtype(b))):
        close = np.isclose(a_num.astype(float), b_num.astype(float), rtol=1e-9, atol=1e-6)
        return both_blank | np.nan_to_num(close, nan=0).astype(bool)
    same = (a.astype(object) == b.astype(object)).fillna(False).to_numpy(dtype=bool)
    return both_blank | same


def _f1(precision: float | None, recall: float | None) -> float | None:
    if precision is None or recall is None or precision + recall == 0:
        return None if precision is None or recall is None else 0.0
    return 2 * precision * recall / (precision + recall)


def _ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def score(reference: pd.DataFrame, corrupted: Corrupted, output: MethodOutput) -> dict:
    cols = detect_columns(reference.columns)
    inp = corrupted.frame
    columns = list(reference.columns)
    kept_rows = np.asarray(output.input_rows, dtype=int)
    kept = np.zeros(len(inp), dtype=bool)
    kept[kept_rows] = True

    # Which cells each method changed (in rows it kept), and whether each
    # cell now matches the reference.
    out = output.frame.reset_index(drop=True)
    true_rows = reference.iloc[corrupted.source[kept_rows]]
    changed: dict[str, np.ndarray] = {}
    correct: dict[str, np.ndarray] = {}
    for column in columns:
        if column not in out.columns:
            continue
        changed[column] = ~_equal(out[column], inp[column].iloc[kept_rows])
        correct[column] = _equal(out[column], true_rows[column])

    errors = corrupted.cell_errors
    error_cells = set(zip(errors["input_row"], errors["column"]))
    error_rows = set(errors["input_row"])
    duplicate_rows = set(np.flatnonzero(corrupted.injected_duplicate))
    position = {int(r): i for i, r in enumerate(kept_rows)}

    # Repair
    changed_cells = sum(int(c.sum()) for c in changed.values())
    correct_changes = sum(int((changed[c] & correct[c]).sum()) for c in changed)
    removed = set(np.flatnonzero(~kept))
    correct_removals = len(removed & duplicate_rows)
    actions = changed_cells + len(removed)

    fixed_by_type = {t: 0 for t in (*CELL_ERRORS, *ROW_ERRORS)}
    units_by_type = {t: 0 for t in (*CELL_ERRORS, *ROW_ERRORS)}
    detected_by_type = {t: 0 for t in (*CELL_ERRORS, *ROW_ERRORS)}
    for row, error_type, column in zip(errors["input_row"], errors["type"], errors["column"]):
        units_by_type[error_type] += 1
        if row in position:
            i = position[row]
            if correct[column][i]:
                fixed_by_type[error_type] += 1
            if changed[column][i] or (row, column) in output.flagged or (row, None) in output.flagged:
                detected_by_type[error_type] += 1
        else:
            detected_by_type[error_type] += 1  # deleting the row counts as detecting it
    for row, error_type in corrupted.duplicate_types.items():
        units_by_type[error_type] += 1
        if row in removed:
            fixed_by_type[error_type] += 1
            detected_by_type[error_type] += 1

    units = sum(units_by_type.values())
    fixed = sum(fixed_by_type.values())
    repair_precision = _ratio(correct_changes + correct_removals, actions)
    repair_recall = _ratio(fixed, units)

    # Detection
    flagged_cells = {(r, c) for r, c in output.flagged if c is not None and r in position}
    flagged_rows = {r for r, c in output.flagged if c is None and r in position}
    changed_cell_set = {
        (int(kept_rows[i]), column) for column, mask in changed.items() for i in np.flatnonzero(mask)
    }
    detections = changed_cell_set | flagged_cells
    useful = len({cell for cell in detections if cell in error_cells})
    useful += len({r for r in flagged_rows if r in error_rows})
    useful += len(removed & (duplicate_rows | error_rows))
    detection_actions = len(detections) + len(flagged_rows) + len(removed)
    detected = sum(detected_by_type.values())

    # Damage and rows kept
    damaged = 0
    for column, mask in changed.items():
        for i in np.flatnonzero(mask & ~correct[column]):
            if (int(kept_rows[i]), column) not in error_cells:
                damaged += 1
    genuine = ~corrupted.injected_duplicate
    rows_kept = _ratio(int((kept & genuine).sum()), int(genuine.sum()))

    # Invoice totals
    invoice, qty, price = cols["invoice"], cols["quantity"], cols["unit_price"]

    def totals(frame: pd.DataFrame) -> pd.Series:
        line = pd.to_numeric(frame[qty], errors="coerce").astype(float) * pd.to_numeric(frame[price], errors="coerce").astype(float)
        return line.fillna(0).groupby(frame[invoice].astype(str)).sum()

    truth = totals(reference)
    cleaned = totals(out).reindex(truth.index).fillna(0)
    within = (cleaned - truth).abs() <= truth.abs() * 0.01

    precision, recall = repair_precision, repair_recall
    detection_precision = _ratio(useful, detection_actions)
    detection_recall = _ratio(detected, units)
    return {
        "repair_precision": precision,
        "repair_recall": recall,
        "repair_f1": _f1(precision, recall),
        "detection_precision": detection_precision,
        "detection_recall": detection_recall,
        "detection_f1": _f1(detection_precision, detection_recall),
        "rows_kept": rows_kept,
        "clean_cells_damaged": damaged,
        "invoices_within_1pct": float(within.mean()) if len(within) else None,
        "units": units,
        "actions": actions,
        "recall_by_type": {t: _ratio(fixed_by_type[t], units_by_type[t]) for t in units_by_type},
        "detection_by_type": {t: _ratio(detected_by_type[t], units_by_type[t]) for t in units_by_type},
        "units_by_type": units_by_type,
    }
