import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import config, main


@pytest.mark.parametrize("enabled", [False, True])
def test_public_ui_config_only_exposes_flag(monkeypatch, enabled):
    monkeypatch.setattr(config, "ORBITAL_UI_ENABLED", enabled)
    monkeypatch.setattr(config, "PUBLIC_DEMO", True)
    monkeypatch.setattr(config, "API_KEY", "private-value")
    with TestClient(main.app) as api:
        response = api.get("/api/config")
        assert response.status_code == 200
        assert response.json() == {"orbitalUiEnabled": enabled}
        assert response.headers["cache-control"] == "no-store"
        assert "set-cookie" not in response.headers


def test_spa_fallback_keeps_api_and_missing_assets_separate(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<main>AEGIS SPA</main>", encoding="utf-8")
    (tmp_path / "pcm-capture.js").write_text("// worklet", encoding="utf-8")
    monkeypatch.setattr(config, "FRONTEND_DIST", tmp_path)
    monkeypatch.setattr(config, "API_KEY", "")
    with TestClient(main.app) as api:
        for path in ("/", "/mission/dashboard"):
            assert api.get(path).text == "<main>AEGIS SPA</main>"
        assert api.get("/pcm-capture.js").text == "// worklet"
        assert api.get("/assets/missing.js").status_code == 404
        assert api.get("/api").status_code == 404
        missing = api.get("/api/missing")
        assert missing.status_code == 404 and missing.json() == {"detail": "Not Found"}
        assert api.post("/api/missing", json={}).status_code == 404
        health = api.get("/api/health")
        assert health.status_code == 200 and health.json() == {
            "status": "ok", "simulation": True, "geminiConfigured": False, "geminiStatus": "unconfigured",
        }


def test_public_visitors_isolate_notes_and_scenarios_across_http_and_websocket(monkeypatch):
    origin = "https://aegis.example"
    monkeypatch.setattr(config, "PUBLIC_DEMO", True)
    monkeypatch.setattr(config, "EXTERNAL_ORIGIN", origin)
    monkeypatch.setattr(config, "API_KEY", "")

    async def live(socket, scenario, day, ui, session_id):
        await socket.accept()
        await socket.send_json({"event_id": main.active_situations(main.situations).read().event_id})
        await socket.close()

    monkeypatch.setattr(main, "live", live)
    with TestClient(main.app, base_url=origin) as first, TestClient(main.app, base_url=origin) as second:
        assert "set-cookie" not in first.get("/api/health").headers
        response = first.get("/api/simulation")
        assert response.headers["cache-control"] == "private, no-store"
        assert "__Host-aegis_visit=" in response.headers["set-cookie"]
        assert "HttpOnly" in response.headers["set-cookie"] and "Secure" in response.headers["set-cookie"]
        fake_note = {"mood": 3, "notes": "nota sintética de visitante A"}
        assert first.post("/api/wellness/checkin", json=fake_note, headers={"origin": origin}).status_code == 201
        assert fake_note["notes"] in first.get("/api/wellness").text
        assert fake_note["notes"] not in second.get("/api/wellness").text
        assert first.post("/api/wellness/checkin", json=fake_note, headers={"origin": "https://otro.example"}).status_code == 403
        activated = first.post("/api/simulation/panic_bio_sync", headers={"origin": origin}).json()
        assert second.get("/api/simulation").json()["scenario_id"] == "nominal"
        with first.websocket_connect("wss://aegis.example/api/live", headers={"origin": origin}) as voice:
            assert voice.receive_json() == {"event_id": activated["event_id"]}
        with pytest.raises(WebSocketDisconnect), first.websocket_connect(
            "wss://aegis.example/api/live", headers={"origin": "https://otro.example"},
        ):
            pass
