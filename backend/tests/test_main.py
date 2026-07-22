# Integration tests covering the root and test/health-check endpoints.
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert "message" in response.json()


def test_test_endpoint():
    response = client.get("/api/v1/test/")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "message": "FastAPI backend is up and running",
    }


def test_ping_endpoint():
    response = client.get("/api/v1/test/ping")
    assert response.status_code == 200
    assert response.json() == {"ping": "pong"}
