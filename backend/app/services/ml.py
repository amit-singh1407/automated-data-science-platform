from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import IsolationForest, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, confusion_matrix, mean_squared_error, r2_score, silhouette_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

try:
    from xgboost import XGBClassifier, XGBRegressor
except ImportError:
    XGBClassifier = None
    XGBRegressor = None


def _detect_target(df: pd.DataFrame) -> str | None:
    for candidate in ("target", "label", "y"):
        if candidate in df.columns:
            return candidate
    return None


def run_automl(df: pd.DataFrame) -> dict:
    result: dict = {"mode": "unsupervised", "models": [], "winner": None}
    if df.empty:
        return {"mode": "none", "error": "Dataset is empty after cleaning."}

    target = _detect_target(df)
    if target is None:
        numeric = df.select_dtypes(include="number")
        if numeric.shape[1] >= 2 and len(numeric) >= 4:
            model = KMeans(n_clusters=2, random_state=42, n_init=10)
            labels = model.fit_predict(numeric)
            score = float(silhouette_score(numeric, labels))
            anomaly_model = IsolationForest(random_state=42, contamination="auto")
            anomaly_labels = anomaly_model.fit_predict(numeric)
            return {
                "mode": "unsupervised",
                "algorithm": "kmeans",
                "clusters": 2,
                "silhouette_score": round(score, 4),
                "anomaly_detection": {
                    "algorithm": "isolation_forest",
                    "anomalies": int((anomaly_labels == -1).sum()),
                },
                "reason": "No explicit target column found; using clustering workflow.",
            }
        return {
            "mode": "none",
            "reason": "No target detected and insufficient numeric data for clustering.",
        }

    y = df[target]
    x = df.drop(columns=[target])
    if len(df) < 5 or y.nunique() < 2:
        return {
            "mode": "none",
            "target": target,
            "reason": "Insufficient rows or target variation for reliable supervised evaluation.",
        }
    stratify = y if y.dtype == "object" or y.nunique() <= 20 else None
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=42, stratify=stratify
    )

    cat_cols = x.select_dtypes(exclude="number").columns.tolist()
    num_cols = x.select_dtypes(include="number").columns.tolist()

    preprocessor = ColumnTransformer(
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

    if y.dtype == "object" or y.nunique() <= 20:
        candidates = [("random_forest_classifier", RandomForestClassifier(random_state=42))]
        if XGBClassifier is not None:
            candidates.append(("xgboost_classifier", XGBClassifier(random_state=42, eval_metric="logloss")))
        best_name = None
        best_score = -1.0
        best_pipeline: Pipeline | None = None
        evaluations = []
        for name, estimator in candidates:
            pipeline = Pipeline([("prep", preprocessor), ("model", estimator)])
            pipeline.fit(x_train, y_train)
            preds = pipeline.predict(x_test)
            score = float(accuracy_score(y_test, preds))
            evaluations.append({
                "model": name,
                "accuracy": round(score, 4),
                "confusion_matrix": confusion_matrix(y_test, preds).tolist(),
            })
            if score > best_score:
                best_score = score
                best_name = name
                best_pipeline = pipeline
        feature_importance = _feature_importance(best_pipeline, num_cols, cat_cols) if best_pipeline else []
        return {
            "mode": "classification",
            "target": target,
            "evaluations": evaluations,
            "winner": {"model": best_name, "accuracy": round(best_score, 4)},
            "feature_importance": feature_importance,
        }

    candidates = [("random_forest_regressor", RandomForestRegressor(random_state=42))]
    if XGBRegressor is not None:
        candidates.append(("xgboost_regressor", XGBRegressor(random_state=42)))
    best_name = None
    best_rmse = float("inf")
    best_pipeline = None
    evaluations = []
    for name, estimator in candidates:
        pipeline = Pipeline([("prep", preprocessor), ("model", estimator)])
        pipeline.fit(x_train, y_train)
        preds = pipeline.predict(x_test)
        rmse = float(np.sqrt(mean_squared_error(y_test, preds)))
        evaluations.append({
            "model": name,
            "rmse": round(rmse, 4),
            "r2_score": round(float(r2_score(y_test, preds)), 4),
            "predictions": preds.tolist(),
        })
        if rmse < best_rmse:
            best_rmse = rmse
            best_name = name
            best_pipeline = pipeline
    feature_importance = _feature_importance(best_pipeline, num_cols, cat_cols) if best_pipeline else []
    return {
        "mode": "regression",
        "target": target,
        "evaluations": evaluations,
        "winner": {
            "model": best_name,
            "rmse": round(best_rmse, 4),
            "r2_score": next(
                evaluation["r2_score"] for evaluation in evaluations if evaluation["model"] == best_name
            ),
        },
        "feature_importance": feature_importance,
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
