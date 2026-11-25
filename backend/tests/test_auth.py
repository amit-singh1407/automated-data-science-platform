"""Login is required, and each user only sees and changes their own jobs."""
import sqlite3

import pandas as pd

from app.core.config import settings

SMALL = pd.DataFrame({"a": [1.0, 2.0, 3.0, 4.0], "b": ["x", "y", "z", "w"]})


def _upload(api, headers) -> str:
    response = api.post("/api/v1/jobs/upload", headers=headers,
                        files={"file": ("small.csv", SMALL.to_csv(index=False).encode(), "text/csv")})
    assert response.status_code == 200, response.text
    return response.json()["job_id"]


def test_requests_without_a_valid_token_are_rejected(api):
    assert api.get("/api/v1/jobs/history").status_code == 401
    assert api.get("/api/v1/jobs/history", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    upload = api.post("/api/v1/jobs/upload", files={"file": ("s.csv", b"a\n1\n", "text/csv")})
    assert upload.status_code == 401


def test_register_login_and_me(api):
    api.register("Person@Example.com", "a-good-password")
    login = api.post("/api/v1/auth/login", json={"email": "person@example.com", "password": "a-good-password"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert api.get("/api/v1/auth/me", headers=headers).json()["email"] == "person@example.com"


def test_wrong_password_duplicate_email_and_short_password(api):
    api.register("someone@example.com", "a-good-password")
    assert api.post("/api/v1/auth/login", json={"email": "someone@example.com", "password": "wrong-password"}).status_code == 401
    assert api.post("/api/v1/auth/register", json={"email": "someone@example.com", "password": "another-one"}).status_code == 409
    assert api.post("/api/v1/auth/register", json={"email": "new@example.com", "password": "short"}).status_code == 422


def test_users_cannot_see_or_change_each_others_jobs(api):
    alice, bob = api.register(), api.register()
    job = _upload(api, alice)

    assert [j["job_id"] for j in api.get("/api/v1/jobs/history", headers=alice).json()] == [job]
    assert api.get("/api/v1/jobs/history", headers=bob).json() == []
    for path in ("status", "results", "audit-logs", "performance", "download/cleaned"):
        assert api.get(f"/api/v1/jobs/{job}/{path}", headers=bob).status_code == 404, path
    assert api.delete(f"/api/v1/jobs/{job}", headers=bob).status_code == 404

    bulk = api.post("/api/v1/jobs/delete-multiple", headers=bob, json={"job_ids": [job]})
    assert bulk.json()["deleted_count"] == 0
    assert api.get(f"/api/v1/jobs/{job}/status", headers=alice).status_code == 200

    assert api.post("/api/v1/jobs/delete-multiple", headers=alice, json={"job_ids": [job]}).json()["deleted_count"] == 1
    assert api.get("/api/v1/jobs/history", headers=alice).json() == []


def test_first_account_takes_over_jobs_from_before_login(api):
    from app.db.database import initialize_database

    initialize_database()
    with sqlite3.connect(settings.database_path) as db:
        db.execute("INSERT INTO users VALUES ('default-user', 'user@autodata.ai', 'nopassword', '2026-01-01')")
        db.execute(
            "INSERT INTO jobs (id, user_id, original_filename, status, created_at, updated_at, progress) "
            "VALUES ('old-job', 'default-user', 'old.csv', 'failed', '2026-01-01', '2026-01-01', 0)"
        )
    first, second = api.register(), api.register()
    assert [j["job_id"] for j in api.get("/api/v1/jobs/history", headers=first).json()] == ["old-job"]
    assert api.get("/api/v1/jobs/history", headers=second).json() == []
    # The placeholder user can never log in.
    assert api.post("/api/v1/auth/login", json={"email": "user@autodata.ai", "password": "nopassword"}).status_code == 401
