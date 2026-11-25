import numpy as np
import pandas as pd

from app.services.ml import run_automl


def _frame(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    a, b = rng.normal(size=n), rng.normal(size=n)
    return pd.DataFrame({"a": a, "b": b, "colour": rng.choice(["red", "blue"], n)}), a, b


def test_classification_reports_real_metrics():
    frame, a, b = _frame()
    frame["target"] = np.where(a + b > 0, "yes", "no")
    result = run_automl(frame)
    winner = result["winner"]
    assert result["mode"] == "classification"
    assert result["classes"] == ["no", "yes"]
    for metric in ("accuracy", "precision", "recall", "f1", "mcc", "roc_auc"):
        assert 0 <= abs(winner[metric]) <= 1, metric
    matrix = np.array(winner["confusion_matrix"])
    assert matrix.shape == (2, 2) and matrix.sum() == result["test_rows"]
    assert len(winner["roc_curve"]["fpr"]) == len(winner["roc_curve"]["tpr"]) > 2


def test_regression_reports_mae_and_actual_vs_predicted():
    frame, a, b = _frame()
    frame["target"] = 3 * a - b + np.random.default_rng(1).normal(scale=0.1, size=len(a))
    result = run_automl(frame)
    winner = result["winner"]
    assert result["mode"] == "regression"
    assert winner["mae"] > 0 and winner["rmse"] >= winner["mae"]
    assert len(winner["actual_vs_predicted"]["actual"]) == len(winner["actual_vs_predicted"]["predicted"])


def test_unsupervised_chooses_k_and_reports_cluster_sizes():
    rng = np.random.default_rng(2)
    blobs = np.vstack([rng.normal(loc, 0.2, size=(100, 2)) for loc in (0, 5, 10)])
    frame = pd.DataFrame(blobs, columns=["width", "height"])
    frame.loc[0, "width"] = np.nan  # missing values must not crash clustering
    result = run_automl(frame)
    assert result["mode"] == "unsupervised"
    assert result["clusters"] == 3
    assert sum(result["cluster_sizes"]) == result["rows_used"] == 299
    assert len(result["cluster_profiles"]["means"]) == 3


def test_no_target_and_no_numbers_explains_why():
    result = run_automl(pd.DataFrame({"name": ["a", "b", "c"]}))
    assert result["mode"] == "none"
    assert result["reason"]
