from __future__ import annotations

import json

from app.models.schemas import OptimizePreferences


def test_optimize_stream_empty_pool_sse(client):
    """Minimal integration: empty pool exits early with SSE complete event."""
    body = {
        "quarter_code": "20262",
        "major_id": "pytest_stream",
        "required_courses": [],
        "optional_courses": [],
        "preferences": OptimizePreferences().model_dump(),
    }
    with client.stream("POST", "/optimize/stream", json=body) as r:
        assert r.status_code == 200
        raw = r.read().decode("utf-8")

    lines = [ln for ln in raw.splitlines() if ln.startswith("data: ")]
    assert len(lines) >= 2
    payloads = [json.loads(ln[6:]) for ln in lines]
    phases = [p["phase"] for p in payloads]
    assert "normalize" in phases
    assert phases[-1] == "complete"
    final = payloads[-1]
    assert final["phase"] == "complete"
    assert "result" in final
    assert final["result"]["candidates"] == []
