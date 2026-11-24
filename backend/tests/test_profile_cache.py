import sqlite3

from app.services.profile_cache import get_cached_profile, store_profile


def test_profile_cache_round_trip():
    db = sqlite3.connect(":memory:")
    db.execute(
        "CREATE TABLE profile_cache (content_hash TEXT, cache_version TEXT, "
        "profile_json TEXT, created_at TEXT, PRIMARY KEY(content_hash, cache_version))"
    )
    profile = {"rows": 3, "quality_score": 91.2}
    store_profile(db, "hash", profile)
    assert get_cached_profile(db, "hash") == profile
