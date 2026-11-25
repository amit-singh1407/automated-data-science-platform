"""Cleaning methods compared in the evaluation: ECP, the six versions with
one feature switched off, and the three baselines from the thesis.

Every method takes the corrupted frame and returns a MethodOutput: the
cleaned rows, the 0-based input row each one came from, and any cells it
flagged for review without changing them.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from app.services.ecp import ECPConfig, detect_columns, run_ecp


@dataclass
class MethodOutput:
    frame: pd.DataFrame
    input_rows: np.ndarray
    flagged: set[tuple[int, str | None]] = field(default_factory=set)


Method = Callable[[pd.DataFrame, int], MethodOutput]


def _ecp(config: ECPConfig) -> Method:
    def run(frame: pd.DataFrame, seed: int) -> MethodOutput:
        result = run_ecp(frame, config)
        flagged = {
            (int(row) - 1, None if column is None or pd.isna(column) else str(column))
            for row, column in zip(result.review["row"], result.review["column"])
        } if len(result.review) else set()
        return MethodOutput(result.cleaned, np.asarray(result.cleaned_rows) - 1, flagged)
    return run


def _keep(frame: pd.DataFrame, mask: np.ndarray) -> MethodOutput:
    rows = np.flatnonzero(mask)
    return MethodOutput(frame.iloc[rows].reset_index(drop=True), rows)


def no_cleaning(frame: pd.DataFrame, seed: int) -> MethodOutput:
    return _keep(frame, np.ones(len(frame), dtype=bool))


def naive_deletion(frame: pd.DataFrame, seed: int) -> MethodOutput:
    """Common practice: delete duplicates, rows with any blank, and rows with
    a non-positive quantity or price."""
    cols = detect_columns(frame.columns)
    qty = pd.to_numeric(frame[cols["quantity"]], errors="coerce")
    price = pd.to_numeric(frame[cols["unit_price"]], errors="coerce")
    keep = ~frame.duplicated() & frame.notna().all(axis=1) & (qty > 0) & (price > 0)
    return _keep(frame, keep.to_numpy())


def _fill_like_a_statistician(out: pd.DataFrame, cols: dict) -> pd.DataFrame:
    price = cols["unit_price"]
    out[price] = pd.to_numeric(out[price], errors="coerce").where(lambda p: p > 0)
    out[price] = out[price].fillna(out[price].median())
    for role in ("customer_id", "country", "description"):
        column = cols.get(role)
        if column is not None and out[column].isna().any():
            out[column] = out[column].fillna(out[column].mode(dropna=True).iloc[0])
    return out


def iqr_statistics(frame: pd.DataFrame, seed: int) -> MethodOutput:
    """Delete duplicates and rows outside 1.5 x IQR of quantity or price
    (one rule for the whole column), then fill blanks with the median or
    most common value."""
    cols = detect_columns(frame.columns)
    keep = ~frame.duplicated()
    for role in ("quantity", "unit_price"):
        values = pd.to_numeric(frame[cols[role]], errors="coerce")
        q1, q3 = values.quantile([0.25, 0.75])
        low, high = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
        keep &= values.isna() | values.between(low, high)
    output = _keep(frame, keep.to_numpy())
    output.frame = _fill_like_a_statistician(output.frame.copy(), cols)
    return output


def isolation_forest(frame: pd.DataFrame, seed: int) -> MethodOutput:
    """Delete duplicates and rows an Isolation Forest marks as anomalies
    (on log quantity and log price), then fill blanks."""
    cols = detect_columns(frame.columns)
    keep = (~frame.duplicated()).to_numpy()
    features = pd.DataFrame({
        role: np.log1p(pd.to_numeric(frame[cols[role]], errors="coerce").clip(lower=0))
        for role in ("quantity", "unit_price")
    })
    features = features.fillna(features.median())
    anomaly = IsolationForest(random_state=seed, contamination="auto").fit_predict(features.to_numpy()) == -1
    output = _keep(frame, keep & ~anomaly)
    output.frame = _fill_like_a_statistician(output.frame.copy(), cols)
    return output


FULL = ECPConfig()
METHODS: dict[str, Method] = {
    "ECP": _ecp(FULL),
    "ECP without dependency repair (S5)": _ecp(replace(FULL, dependency_repair=False)),
    "ECP with one global outlier rule (S6)": _ecp(replace(FULL, per_product_checks=False)),
    "ECP deduplicating before standardising": _ecp(replace(FULL, standardise_before_dedupe=False)),
    "ECP without fuzzy country matching": _ecp(replace(FULL, fuzzy_countries=False)),
    "ECP without safety checks (S6)": _ecp(replace(FULL, safety_checks=False)),
    "ECP also repairing quantities": _ecp(replace(FULL, repair_quantities=True)),
    "Naive deletion": naive_deletion,
    "IQR statistics": iqr_statistics,
    "Isolation Forest": isolation_forest,
    "No cleaning": no_cleaning,
}
