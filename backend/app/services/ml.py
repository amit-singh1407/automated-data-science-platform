from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import IsolationForest, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    matthews_corrcoef,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    silhouette_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, OneHotEncoder

try:
    from xgboost import XGBClassifier, XGBRegressor
except ImportError:
    XGBClassifier = None
    XGBRegressor = None

# Supervised models are trained on at most this many rows so that large
# uploads (e.g. 500k order lines) finish in reasonable time.
MAX_SUPERVISED_ROWS = 100_000
# A text target with more classes than this is not treated as classification.
MAX_CLASSES = 50
# Clusters tried when choosing k for KMeans.
CLUSTER_RANGE = range(2, 7)


def _detect_target(df: pd.DataFrame) -> str | None:
    for candidate in ("target", "label", "y"):
        if candidate in df.columns:
            return candidate
    return None


def _round(value: float | None, digits: int = 4) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return round(float(value), digits)


def _downsample(xs: np.ndarray, ys: np.ndarray, limit: int = 100) -> tuple[list[float], list[float]]:
    if len(xs) > limit:
        index = np.unique(np.linspace(0, len(xs) - 1, limit).astype(int))
        xs, ys = xs[index], ys[index]
    return [round(float(v), 4) for v in xs], [round(float(v), 4) for v in ys]


def _preprocessor(x: pd.DataFrame) -> tuple[ColumnTransformer, list[str], list[str]]:
    cat_cols = x.select_dtypes(exclude="number").columns.tolist()
    num_cols = x.select_dtypes(include="number").columns.tolist()
    transformer = ColumnTransformer(
        transformers=[
            ("num", Pipeline([("imputer", SimpleImputer(strategy="median"))]), num_cols),
            (
                "cat",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                cat_cols,
            ),
        ]
    )
    return transformer, num_cols, cat_cols


def run_automl(df: pd.DataFrame) -> dict:
    if df.empty:
        return {"mode": "none", "reason": "Dataset is empty after cleaning."}

    target = _detect_target(df)
    if target is None:
        return _run_unsupervised(df)

    data = df[df[target].notna()]
    if len(data) < 10 or data[target].nunique() < 2:
        return {
            "mode": "none",
            "target": target,
            "reason": "Too few rows or only one target value, so a model cannot be evaluated reliably.",
        }
    rows_available = len(data)
    if len(data) > MAX_SUPERVISED_ROWS:
        data = data.sample(MAX_SUPERVISED_ROWS, random_state=42)

    y = data[target]
    x = data.drop(columns=[target])
    for column in x.select_dtypes(include=["datetime", "datetimetz"]).columns:
        x = x.drop(columns=[column])
    is_text_target = not pd.api.types.is_numeric_dtype(y)
    if is_text_target and y.nunique() > MAX_CLASSES:
        return {
            "mode": "none",
            "target": target,
            "reason": f"The target has {y.nunique()} different text values; classification is limited to {MAX_CLASSES}.",
        }

    if is_text_target or y.nunique() <= 20:
        result = _run_classification(x, y)
    else:
        result = _run_regression(x, y.astype(float))
    result.update(target=target, rows_available=rows_available, rows_used=len(data))
    return result


# ─── Classification ───────────────────────────────────────────────────────────
def _run_classification(x: pd.DataFrame, y: pd.Series) -> dict:
    encoder = LabelEncoder()
    y_encoded = encoder.fit_transform(y.astype(str))
    classes = encoder.classes_.tolist()
    binary = len(classes) == 2
    class_counts = np.bincount(y_encoded)
    stratify = y_encoded if class_counts.min() >= 2 else None
    x_train, x_test, y_train, y_test = train_test_split(
        x, y_encoded, test_size=0.2, random_state=42, stratify=stratify
    )

    candidates = [("random_forest_classifier", RandomForestClassifier(random_state=42, n_jobs=-1))]
    if XGBClassifier is not None:
        candidates.append(("xgboost_classifier", XGBClassifier(random_state=42, eval_metric="logloss")))

    average = "binary" if binary else "macro"
    evaluations: list[dict] = []
    best: tuple[float, dict, Pipeline] | None = None
    num_cols: list[str] = []
    cat_cols: list[str] = []
    for name, estimator in candidates:
        preprocessor, num_cols, cat_cols = _preprocessor(x)
        pipeline = Pipeline([("prep", preprocessor), ("model", estimator)])
        pipeline.fit(x_train, y_train)
        preds = pipeline.predict(x_test)
        proba = pipeline.predict_proba(x_test) if hasattr(pipeline, "predict_proba") else None

        roc_auc = None
        roc_points = None
        if proba is not None:
            try:
                if binary:
                    roc_auc = roc_auc_score(y_test, proba[:, 1])
                    fpr, tpr, _ = roc_curve(y_test, proba[:, 1])
                    xs, ys = _downsample(fpr, tpr)
                    roc_points = {"fpr": xs, "tpr": ys}
                else:
                    roc_auc = roc_auc_score(
                        y_test, proba, multi_class="ovr", average="macro", labels=list(range(len(classes)))
                    )
            except ValueError:
                roc_auc = None  # e.g. a class missing from the test split

        evaluation = {
            "model": name,
            "accuracy": _round(accuracy_score(y_test, preds)),
            "precision": _round(precision_score(y_test, preds, average=average, zero_division=0)),
            "recall": _round(recall_score(y_test, preds, average=average, zero_division=0)),
            "f1": _round(f1_score(y_test, preds, average=average, zero_division=0)),
            "mcc": _round(matthews_corrcoef(y_test, preds)),
            "roc_auc": _round(roc_auc),
            "confusion_matrix": confusion_matrix(y_test, preds, labels=list(range(len(classes)))).tolist(),
        }
        evaluations.append(evaluation)
        score = evaluation["accuracy"] or 0.0
        if best is None or score > best[0]:
            best = (score, {**evaluation, "roc_curve": roc_points}, pipeline)

    assert best is not None
    return {
        "mode": "classification",
        "classes": classes,
        "averaging": "binary (positive class: " + str(classes[1]) + ")" if binary else "macro average over classes",
        "selection_metric": "accuracy",
        "test_rows": int(len(y_test)),
        "evaluations": evaluations,
        "winner": best[1],
        "feature_importance": _feature_importance(best[2], num_cols, cat_cols),
    }


# ─── Regression ───────────────────────────────────────────────────────────────
def _run_regression(x: pd.DataFrame, y: pd.Series) -> dict:
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.2, random_state=42)
    candidates = [("random_forest_regressor", RandomForestRegressor(random_state=42, n_jobs=-1))]
    if XGBRegressor is not None:
        candidates.append(("xgboost_regressor", XGBRegressor(random_state=42)))

    evaluations: list[dict] = []
    best: tuple[float, dict, Pipeline] | None = None
    num_cols: list[str] = []
    cat_cols: list[str] = []
    for name, estimator in candidates:
        preprocessor, num_cols, cat_cols = _preprocessor(x)
        pipeline = Pipeline([("prep", preprocessor), ("model", estimator)])
        pipeline.fit(x_train, y_train)
        preds = pipeline.predict(x_test)
        rmse = float(np.sqrt(mean_squared_error(y_test, preds)))
        evaluation = {
            "model": name,
            "rmse": _round(rmse),
            "mae": _round(mean_absolute_error(y_test, preds)),
            "r2_score": _round(r2_score(y_test, preds)),
        }
        evaluations.append(evaluation)
        if best is None or rmse < best[0]:
            sample = np.random.default_rng(42).permutation(len(preds))[:300]
            actual_vs_predicted = {
                "actual": [round(float(v), 4) for v in np.asarray(y_test)[sample]],
                "predicted": [round(float(v), 4) for v in preds[sample]],
            }
            best = (rmse, {**evaluation, "actual_vs_predicted": actual_vs_predicted}, pipeline)

    assert best is not None
    return {
        "mode": "regression",
        "selection_metric": "lowest RMSE",
        "test_rows": int(len(y_test)),
        "evaluations": evaluations,
        "winner": best[1],
        "feature_importance": _feature_importance(best[2], num_cols, cat_cols),
    }


# ─── Unsupervised ─────────────────────────────────────────────────────────────
def _run_unsupervised(df: pd.DataFrame) -> dict:
    numeric = df.select_dtypes(include="number").replace([np.inf, -np.inf], np.nan).dropna()
    numeric = numeric.loc[:, numeric.nunique() > 1]
    if numeric.shape[1] < 2 or len(numeric) < 20:
        return {
            "mode": "none",
            "reason": "No target column (target, label or y) and not enough numeric data for clustering.",
        }

    sample = numeric.sample(min(len(numeric), 20_000), random_state=42)
    k_scores: dict[int, float] = {}
    for k in CLUSTER_RANGE:
        if len(sample) <= k:
            break
        labels = KMeans(n_clusters=k, random_state=42, n_init=3).fit_predict(sample)
        if len(set(labels)) < 2:
            continue
        k_scores[k] = float(
            silhouette_score(sample, labels, sample_size=min(len(sample), 5_000), random_state=42)
        )
    if not k_scores:
        return {"mode": "none", "reason": "The numeric data could not be split into clusters."}
    best_k = max(k_scores, key=lambda k: k_scores[k])

    model = KMeans(n_clusters=best_k, random_state=42, n_init=3)
    labels = model.fit_predict(numeric)
    silhouette = float(
        silhouette_score(numeric, labels, sample_size=min(len(numeric), 10_000), random_state=42)
    )
    sizes = np.bincount(labels, minlength=best_k)
    profile_columns = numeric.var().sort_values(ascending=False).index[:8].tolist()
    means = numeric[profile_columns].groupby(labels).mean()

    anomaly_labels = IsolationForest(random_state=42, contamination="auto").fit_predict(numeric)
    anomalies = int((anomaly_labels == -1).sum())
    return {
        "mode": "unsupervised",
        "algorithm": "kmeans",
        "reason": "No target column (target, label or y) found, so the data was clustered instead.",
        "rows_used": int(len(numeric)),
        "features": numeric.columns.tolist(),
        "clusters": int(best_k),
        "k_scores": {str(k): round(v, 4) for k, v in k_scores.items()},
        "silhouette_score": round(silhouette, 4),
        "cluster_sizes": [int(v) for v in sizes],
        "cluster_profiles": {
            "columns": profile_columns,
            "means": [[_round(v) for v in row] for row in means.to_numpy()],
        },
        "anomaly_detection": {
            "algorithm": "isolation_forest",
            "anomalies": anomalies,
            "share": round(anomalies / len(numeric), 4),
        },
    }


def _feature_importance(pipeline: Pipeline, numeric_columns: list[str], categorical_columns: list[str]) -> list[dict]:
    model = pipeline.named_steps["model"]
    if not hasattr(model, "feature_importances_"):
        return []
    names = numeric_columns[:]
    if categorical_columns:
        encoder = pipeline.named_steps["prep"].named_transformers_["cat"].named_steps["encoder"]
        names.extend(encoder.get_feature_names_out(categorical_columns).tolist())
    return [
        {"feature": name, "importance": round(float(value), 6)}
        for name, value in sorted(
            zip(names, model.feature_importances_), key=lambda item: item[1], reverse=True
        )[:20]
    ]
