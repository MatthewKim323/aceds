from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session", autouse=True)
def _test_env():
    os.environ.setdefault("ACE_ENV", "test")
    os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
    yield


@pytest.fixture
def client():
    from app.main import create_app

    return TestClient(create_app())
