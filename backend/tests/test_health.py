from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.main import app


def test_health():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"


def test_database_connection_can_be_used_by_fastapi_worker_thread():
    client = TestClient(app)
    response = client.get(
        "/api/v1/jobs/history",
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert response.status_code == 401
