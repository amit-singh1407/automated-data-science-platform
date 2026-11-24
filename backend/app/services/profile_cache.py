from __future__ import annotations

import json
import sqlite3
from typing import Any


PROFILE_CACHE_VERSION = "1"


def get_cached_profile(
    db: sqlite3.Connection, content_hash: str
) -> dict[str, Any] | None:
    row = db.execute(
        "SELECT profile_json FROM profile_cache "
        "WHERE content_hash = ? AND cache_version = ?",
        (content_hash, PROFILE_CACHE_VERSION),
    ).fetchone()
    if not row:
        return None
    return json.loads(row["profile_json"] if isinstance(row, sqlite3.Row) else row[0])


def store_profile(
    db: sqlite3.Connection, content_hash: str, profile: dict[str, Any]
) -> None:
    db.execute(
        "INSERT OR REPLACE INTO profile_cache "
        "(content_hash, cache_version, profile_json, created_at) "
        "VALUES (?, ?, ?, datetime('now'))",
        (content_hash, PROFILE_CACHE_VERSION, json.dumps(profile)),
    )
    db.commit()
