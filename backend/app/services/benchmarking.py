from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import perf_counter

import pandas as pd

from app.services.cleaning import apply_ecp_rules, apply_general_cleaning_rules
from app.services.ml import run_automl
from app.services.performance import measure_stage, runtime_metadata
from app.services.profiling import build_profile
from app.services.transformation import transform_features


def run_benchmark(row_count: int, repetitions: int = 1) -> dict:
    frame = pd.DataFrame(
        {
            "feature_a": range(row_count),
            "feature_b": [value % 17 for value in range(row_count)],
            "category": [f"group-{value % 5}" for value in range(row_count)],
        }
    )
    runs: list[dict] = []
    for repetition in range(repetitions):
        stages: list[dict] = []
        started = perf_counter()
        with measure_stage("profiling", len(frame)) as measurement:
            profile = build_profile(frame)
        stages.append(measurement)
        with measure_stage("cleaning", len(frame)) as measurement:
            ecp_frame, _, _ = apply_ecp_rules(frame)
            cleaned_frame, _, _ = apply_general_cleaning_rules(ecp_frame)
        stages.append(measurement)
        with measure_stage("transformation", len(cleaned_frame)) as measurement:
            transformed_frame, _ = transform_features(cleaned_frame)
        stages.append(measurement)
        with measure_stage("analysis", len(transformed_frame)) as measurement:
            ml_result = run_automl(transformed_frame)
        stages.append(measurement)
        runs.append(
            {
                "repetition": repetition + 1,
                "total_duration_ms": round((perf_counter() - started) * 1000, 3),
                "stages": stages,
                "profile_rows": profile["rows"],
                "ml_mode": ml_result.get("mode"),
            }
        )
    return {
        "row_count": row_count,
        "repetitions": repetitions,
        "runtime": runtime_metadata(),
        "runs": runs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run measured AutoData AI pipeline benchmarks.")
    parser.add_argument("--sizes", default="10000,100000", help="Comma-separated row counts.")
    parser.add_argument("--repetitions", type=int, default=1)
    parser.add_argument("--output", type=Path, default=Path("benchmark-results.json"))
    args = parser.parse_args()
    results = [
        run_benchmark(int(size.strip()), args.repetitions)
        for size in args.sizes.split(",")
        if size.strip()
    ]
    args.output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Wrote measured benchmark results to {args.output}")


if __name__ == "__main__":
    main()
