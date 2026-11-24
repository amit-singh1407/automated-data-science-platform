from __future__ import annotations

import hashlib
import platform
import tracemalloc
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Iterator


def fingerprint_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def runtime_metadata() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
    }


@dataclass
class StageMeasurement:
    stage: str
    started_at: str
    duration_ms: float
    peak_memory_bytes: int
    rows_processed: int


@contextmanager
def measure_stage(stage: str, rows_processed: int) -> Iterator[dict[str, object]]:
    started_at = datetime.now(timezone.utc).isoformat()
    tracemalloc.start()
    started = perf_counter()
    measurement: dict[str, object] = {}
    try:
        yield measurement
    finally:
        _, peak_memory = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        measurement.update(
            stage=stage,
            started_at=started_at,
            duration_ms=round((perf_counter() - started) * 1000, 3),
            peak_memory_bytes=peak_memory,
            rows_processed=rows_processed,
        )
