from __future__ import annotations

import pandas as pd
from sklearn.preprocessing import MinMaxScaler


def transform_features(df: pd.DataFrame, target_column: str | None = None) -> tuple[pd.DataFrame, dict]:
    transformed = df.copy()
    details: dict = {"steps": [], "target_column": target_column}
    generated_columns: set[str] = set()

    if target_column is None:
        target_column = next(
            (candidate for candidate in ("target", "label", "y") if candidate in transformed.columns),
            None,
        )
        details["target_column"] = target_column

    constant_columns = [
        column for column in transformed.columns
        if column != target_column and transformed[column].nunique(dropna=False) <= 1
    ]
    if constant_columns:
        transformed = transformed.drop(columns=constant_columns)
        details["steps"].append(
            {
                "step": "remove_constant_features",
                "columns": constant_columns,
                "reason": "Constant predictors cannot improve a model and waste memory.",
            }
        )

    for col in transformed.select_dtypes(include=["object", "string"]).columns.tolist():
        if col == target_column:
            continue
        parsed = pd.to_datetime(transformed[col], format="mixed", errors="coerce")
        if parsed.notna().mean() >= 0.8:
            transformed[f"{col}_year"] = parsed.dt.year
            transformed[f"{col}_month"] = parsed.dt.month
            transformed[f"{col}_day"] = parsed.dt.day
            generated_columns.update({f"{col}_year", f"{col}_month", f"{col}_day"})
            details["steps"].append(
                {
                    "step": "date_feature_extraction",
                    "column": col,
                    "features": [f"{col}_year", f"{col}_month", f"{col}_day"],
                    "reason": "Extract calendar features from a consistently parseable date column.",
                }
            )

    numeric_cols = [
        column for column in transformed.select_dtypes(include="number").columns.tolist()
        if column != target_column
    ]
    if numeric_cols:
        scaler = MinMaxScaler()
        transformed[numeric_cols] = scaler.fit_transform(transformed[numeric_cols])
        details["steps"].append(
            {
                "step": "min_max_scaling",
                "columns": numeric_cols,
                "reason": "Normalize numeric features for model readiness.",
            }
        )

    if len(numeric_cols) >= 2:
        c1, c2 = numeric_cols[0], numeric_cols[1]
        transformed[f"{c1}_{c2}_interaction"] = transformed[c1] * transformed[c2]
        details["steps"].append(
            {
                "step": "interaction_feature",
                "feature": f"{c1}_{c2}_interaction",
                "reason": "Capture pairwise effect between top numeric columns.",
            }
        )

    duplicate_columns = [
        column for column in transformed.columns
        if column != target_column and column not in generated_columns and any(
            column != other and transformed[column].equals(transformed[other])
            for other in transformed.columns
            if other not in generated_columns
        )
    ]
    if duplicate_columns:
        transformed = transformed.drop(columns=duplicate_columns)
        details["steps"].append(
            {
                "step": "remove_duplicate_features",
                "columns": duplicate_columns,
                "reason": "Exact duplicate predictors add no new information.",
            }
        )

    details["columns_after_transformation"] = transformed.columns.tolist()
    return transformed, details
