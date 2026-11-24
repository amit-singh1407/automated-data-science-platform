import sqlite3
from collections.abc import Generator

from app.core.config import settings


def initialize_database() -> None:
    with sqlite3.connect(settings.database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                hashed_password TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT,
                profile_json TEXT,
                cleaning_json TEXT,
                transform_json TEXT,
                ml_json TEXT,
                visualization_json TEXT,
                audit_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_user_created
            ON jobs (user_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS job_stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                stage TEXT NOT NULL,
                started_at TEXT NOT NULL,
                duration_ms REAL NOT NULL,
                peak_memory_bytes INTEGER NOT NULL,
                rows_processed INTEGER NOT NULL,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_job_stages_job
            ON job_stages (job_id, id);
            CREATE TABLE IF NOT EXISTS dataset_fingerprints (
                job_id TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                row_count INTEGER,
                column_count INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS profile_cache (
                content_hash TEXT NOT NULL,
                cache_version TEXT NOT NULL,
                profile_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (content_hash, cache_version)
            );
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
        if "progress" not in columns:
            connection.execute("ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
        if "progress_message" not in columns:
            connection.execute("ALTER TABLE jobs ADD COLUMN progress_message TEXT")


def get_db() -> Generator[sqlite3.Connection, None, None]:
    initialize_database()
    # FastAPI may create and execute a synchronous dependency in different
    # worker threads. Each request still receives its own connection.
    connection = sqlite3.connect(settings.database_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()
