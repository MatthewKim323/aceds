def test_catalog_meta(client):
    r = client.get("/catalog/meta")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "ucsb-api"
    assert len(body["quarter"]) == 5
    assert body["quarter"].isdigit()
    assert "label" in body
    assert "ucsb_api_configured" in body
    assert isinstance(body["department_fetch_count"], int)
    assert isinstance(body["department_codes"], list)
    assert body["department_fetch_count"] == len(body["department_codes"])
