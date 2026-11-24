import pandas as pd

from app.services.cleaning import apply_ecp_rules, apply_general_cleaning_rules
from app.services.profiling import build_profile
from app.services.transformation import transform_features


def test_profile_cleaning_and_transformation_preserve_auditability():
    frame = pd.DataFrame(
        {
            "order_date": ["2025-01-01", "2025-01-02", "2025-01-02", "2025-01-03"],
            "amount": [10.0, 10.0, 10.0, None],
            "customer": [" A ", "B", "B", "C"],
        }
    )

    profile = build_profile(frame)
    ecp_frame, ecp_audit, _ = apply_ecp_rules(frame)
    cleaned_frame, general_audit, _ = apply_general_cleaning_rules(ecp_frame)
    transformed_frame, transformation = transform_features(cleaned_frame)

    assert profile["duplicate_rows"] == 1
    assert any(entry.get("stage") == 7 for entry in ecp_audit)
    assert any(entry["rule"] == "impute_numeric_median" for entry in general_audit)
    assert "order_date_year" in transformed_frame.columns
    assert transformation["steps"]


def test_transformation_preserves_target_values():
    frame = pd.DataFrame({"value": [1.0, 2.0, 3.0], "target": [10.0, 20.0, 30.0]})
    transformed, details = transform_features(frame)
    assert transformed["target"].tolist() == [10.0, 20.0, 30.0]
    assert details["target_column"] == "target"
