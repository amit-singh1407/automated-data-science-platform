from __future__ import annotations

from pathlib import Path
import sys
from itertools import count

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_emails = count(1)


@pytest.fixture
def api(tmp_path, monkeypatch):
    """A test client on a fresh database and upload folder, plus a helper that
    registers a user and returns that user's Authorization header."""
    from fastapi.testclient import TestClient

    from app.core.config import settings
    from app.main import app

    monkeypatch.setattr(settings, "uploads_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "sqlite_path", str(tmp_path / "test.db"))
    settings.uploads_dir.mkdir(parents=True)
    client = TestClient(app)

    def register(email: str | None = None, password: str = "correct-horse-1") -> dict[str, str]:
        email = email or f"user{next(_emails)}@example.com"
        response = client.post("/api/v1/auth/register", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    client.register = register  # type: ignore[attr-defined]
    return client
