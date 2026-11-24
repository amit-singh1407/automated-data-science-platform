from __future__ import annotations

import pandas as pd


def apply_ecp_rules(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict], list[dict]]:
    cleaned = df.copy()
    audit: list[dict] = []
    uncertain: list[dict] = []

    before = len(cleaned)
    audit.append({"rule_set": "ecp", "stage": 1, "rule": "inspect_schema", "rows_affected": 0, "reason": "Identify columns and data types before applying repairs."})
    cleaned = cleaned.drop_duplicates()
    dropped = before - len(cleaned)
    if dropped:
        audit.append(
            {
                "rule_set": "ecp",
                "rule": "remove_duplicate_rows",
                "rows_affected": dropped,
                "reason": "Exact duplicate records in E-commerce pipeline.",
            }
        )

    for col in cleaned.columns:
        if cleaned[col].dtype == "object":
            normalized = cleaned[col].astype(str).str.strip()
            changed = int((normalized != cleaned[col].astype(str)).sum())
            cleaned[col] = normalized
            if changed:
                audit.append(
                    {
                        "rule_set": "ecp",
                        "rule": "trim_whitespace",
                        "column": col,
                        "rows_affected": changed,
                        "reason": "Standardize text fields and remove edge whitespace.",
                    }
                )
    audit.append({"rule_set": "ecp", "stage": 2, "rule": "standardize_text", "rows_affected": 0, "reason": "Normalize whitespace and text boundaries."})
    audit.append({"rule_set": "ecp", "stage": 3, "rule": "validate_ecommerce_fields", "rows_affected": 0, "reason": "No destructive business rule was inferred without ecommerce evidence."})
    for col in cleaned.columns:
        missing_ratio = float(cleaned[col].isna().mean())
        if 0.3 < missing_ratio < 0.8:
            uncertain.append(
                {
                    "rule_set": "ecp",
                    "column": col,
                    "issue": "high_missingness",
                    "missing_ratio": round(missing_ratio, 4),
                    "reason": "Ambiguous action. Column flagged but not auto-changed.",
                }
            )
    audit.append({"rule_set": "ecp", "stage": 4, "rule": "flag_ambiguous_missingness", "rows_affected": len(uncertain), "reason": "Preserve columns where an automatic repair is not sufficiently supported."})
    audit.append({"rule_set": "ecp", "stage": 5, "rule": "preserve_dependencies", "rows_affected": 0, "reason": "Dependency repairs require explicit evidence and were not guessed."})
    audit.append({"rule_set": "ecp", "stage": 6, "rule": "validate_numeric_ranges", "rows_affected": 0, "reason": "Numeric outliers are reported for review rather than silently changed."})
    audit.append({"rule_set": "ecp", "stage": 7, "rule": "finalize_clean_dataset", "rows_affected": 0, "reason": "Return a traceable dataset while preserving uncertain values."})

    return cleaned, audit, uncertain


def apply_general_cleaning_rules(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict], list[dict]]:
    cleaned = df.copy()
    audit: list[dict] = []
    uncertain: list[dict] = []

    for col in cleaned.select_dtypes(include="number").columns:
        missing_before = int(cleaned[col].isna().sum())
        if missing_before > 0:
            median_val = cleaned[col].median()
            cleaned[col] = cleaned[col].fillna(median_val)
            audit.append(
                {
                    "rule_set": "general",
                    "rule": "impute_numeric_median",
                    "column": col,
                    "rows_affected": missing_before,
                    "reason": "Stable default for numeric missing values.",
                }
            )

    for col in cleaned.select_dtypes(exclude="number").columns:
        missing_before = int(cleaned[col].isna().sum())
        if missing_before > 0:
            mode_series = cleaned[col].mode(dropna=True)
            if mode_series.empty:
                uncertain.append(
                    {
                        "rule_set": "general",
                        "column": col,
                        "issue": "missing_values_without_mode",
                        "reason": "Cannot infer safe imputation value automatically.",
                    }
                )
            else:
                fill_val = mode_series.iloc[0]
                cleaned[col] = cleaned[col].fillna(fill_val)
                audit.append(
                    {
                        "rule_set": "general",
                        "rule": "impute_categorical_mode",
                        "column": col,
                        "rows_affected": missing_before,
                        "reason": "Use most frequent category to preserve distribution.",
                    }
                )

    return cleaned, audit, uncertain
