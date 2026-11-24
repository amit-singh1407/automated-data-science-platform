from __future__ import annotations

import pandas as pd


def build_profile(df: pd.DataFrame) -> dict:
    dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
    missing = {col: int(val) for col, val in df.isna().sum().to_dict().items()}
    duplicates = int(df.duplicated().sum())
    numeric_summary = (
        df.describe(include="number").fillna(0).round(4).to_dict()
        if not df.select_dtypes(include="number").empty
        else {}
    )
    categorical_summary = (
        {
            col: df[col].astype(str).value_counts(dropna=False).head(10).to_dict()
            for col in df.select_dtypes(exclude="number").columns
        }
        if len(df.columns) > 0
        else {}
    )
    unusual_values = {}
    for col in df.select_dtypes(include="number").columns:
        series = df[col].dropna()
        if len(series) >= 4:
            q1, q3 = series.quantile([0.25, 0.75])
            iqr = q3 - q1
            lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            unusual_values[col] = int(((series < lower) | (series > upper)).sum())
    missing_ratio = sum(missing.values()) / max(1, df.size)
    duplicate_ratio = duplicates / max(1, len(df))
    outlier_count = sum(unusual_values.values())
    outlier_ratio = outlier_count / max(1, df.shape[0] * max(1, len(df.select_dtypes(include="number").columns)))
    quality_score = max(
        0.0,
        100.0 - (missing_ratio * 60.0) - (duplicate_ratio * 25.0) - (outlier_ratio * 15.0),
    )

    return {
        "rows": int(df.shape[0]),
        "columns": int(df.shape[1]),
        "data_types": dtypes,
        "missing_values": missing,
        "duplicate_rows": duplicates,
        "quality_score": round(quality_score, 2),
        "quality_method": "100 minus weighted missing, duplicate, and unusual-value rates; not a model prediction accuracy.",
        "numeric_summary": numeric_summary,
        "categorical_summary": categorical_summary,
        "unusual_numeric_values": unusual_values,
    }
