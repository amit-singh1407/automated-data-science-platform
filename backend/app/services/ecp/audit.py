"""Audit log and review queue.

Every change ECP makes is recorded with the stage, row, column, old value,
new value and reason (thesis, Chapter 3). Rows that look wrong but cannot be
repaired safely go to the review queue instead of being changed.
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd

AUDIT_COLUMNS = ["stage", "row", "column", "action", "old_value", "new_value", "reason"]
REVIEW_COLUMNS = ["stage", "row", "column", "issue", "value", "reason"]


def _as_object_array(values: Any, length: int) -> np.ndarray:
    if isinstance(values, pd.Series):
        return values.to_numpy(dtype=object)
    if isinstance(values, (list, tuple, np.ndarray)):
        return np.asarray(values, dtype=object)
    array = np.empty(length, dtype=object)
    array[:] = [values] * length
    return array


class _Recorder:
    columns: list[str]

    def __init__(self) -> None:
        self._chunks: list[pd.DataFrame] = []
        self.counts: dict[str, dict[str, int]] = {}

    def _add(self, stage: str, kind: str, data: dict[str, Any], length: int) -> None:
        self._chunks.append(pd.DataFrame(data, columns=self.columns))
        by_stage = self.counts.setdefault(stage, {})
        by_stage[kind] = by_stage.get(kind, 0) + length

    def to_frame(self) -> pd.DataFrame:
        if not self._chunks:
            return pd.DataFrame(columns=self.columns)
        return pd.concat(self._chunks, ignore_index=True)

    def total(self, stage: str | None = None) -> int:
        stages = [stage] if stage else list(self.counts)
        return sum(sum(self.counts.get(s, {}).values()) for s in stages)


class AuditLog(_Recorder):
    columns = AUDIT_COLUMNS

    def record(
        self,
        stage: str,
        rows: Any,
        column: Any,
        action: str,
        old: Any,
        new: Any,
        reason: str,
    ) -> int:
        rows = np.asarray(rows, dtype="int64")
        length = len(rows)
        if length == 0:
            return 0
        self._add(
            stage,
            action,
            {
                "stage": stage,
                "row": rows,
                "column": None if column is None else str(column),
                "action": action,
                "old_value": _as_object_array(old, length),
                "new_value": _as_object_array(new, length),
                "reason": reason,
            },
            length,
        )
        return length


class ReviewQueue(_Recorder):
    columns = REVIEW_COLUMNS

    def record(self, stage: str, rows: Any, column: Any, issue: str, values: Any, reason: str) -> int:
        rows = np.asarray(rows, dtype="int64")
        length = len(rows)
        if length == 0:
            return 0
        self._add(
            stage,
            issue,
            {
                "stage": stage,
                "row": rows,
                "column": None if column is None else str(column),
                "issue": issue,
                "value": _as_object_array(values, length),
                "reason": reason,
            },
            length,
        )
        return length


def jsonable(value: Any) -> Any:
    """Convert pandas and numpy scalars into JSON-safe Python values."""
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return None if math.isnan(number) or math.isinf(number) else number
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def frame_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [
        {str(key): jsonable(value) for key, value in record.items()}
        for record in frame.to_dict(orient="records")
    ]
