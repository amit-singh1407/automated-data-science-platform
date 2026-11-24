from pathlib import Path

import pandas as pd

from app.services.benchmarking import run_benchmark
from app.services.performance import fingerprint_file


def test_fingerprint_is_deterministic(tmp_path: Path):
    path = tmp_path / "dataset.csv"
    path.write_text("value\n1\n2\n", encoding="utf-8")
    assert fingerprint_file(path) == fingerprint_file(path)


def test_benchmark_reports_measured_stages():
    result = run_benchmark(12)
    assert result["row_count"] == 12
    assert result["runs"][0]["total_duration_ms"] >= 0
    assert {stage["stage"] for stage in result["runs"][0]["stages"]} == {
        "profiling",
        "cleaning",
        "transformation",
        "analysis",
    }
