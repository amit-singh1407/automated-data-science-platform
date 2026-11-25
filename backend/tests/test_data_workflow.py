import pandas as pd

from app.services.ecp import run_ecp
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
    ecp = run_ecp(frame)
    transformed_frame, transformation = transform_features(ecp.cleaned)

    assert profile["duplicate_rows"] == 1
    assert ecp.summary["rows"]["moved"]["duplicates"] == 1
    # After removing the duplicate, 1 of 3 amounts is blank (33%): too many to
    # fill safely, so it is reported instead of invented.
    assert any(case["column"] == "amount" for case in ecp.summary["uncertain_cases"])
    assert any(entry["action"] == "standardise" for entry in ecp.summary["audit_log_sample"])
    assert {"old_value", "new_value", "reason"} <= set(ecp.audit.columns)
    assert "order_date_year" in transformed_frame.columns
    assert transformation["steps"]


def test_transformation_preserves_target_values():
    frame = pd.DataFrame({"value": [1.0, 2.0, 3.0], "target": [10.0, 20.0, 30.0]})
    transformed, details = transform_features(frame)
    assert transformed["target"].tolist() == [10.0, 20.0, 30.0]
    assert details["target_column"] == "target"
