from uuid import uuid4

from fastapi.testclient import TestClient

from app import config
from app.companion_state import MissionPosition
from app.companion_tools import dispatch
from app.live_vitals import MonitorStore, MonitorUpdate, visitor_monitor
from app.main import app


def sample(bpm=77, **extras):
    return {"profile": "custom" if bpm != 77 else "normal", "ecgBpm": bpm,
            "spo2": 98, "sto2": 84, "rso2": 68, "radiationProfile": "saludable",
            "h2o2": 2.8, "o2": 0.32, "onoo": 12, "no": 35, "gsh": 4.7, "mda": 0.85, **extras}


def update(tab, mode="simulation", value=None, epoch=0):
    return {"tab": str(tab), "epoch": epoch, "mode": mode, "sample": value}


def test_dashboard_and_gemini_share_current_samples_and_coverage():
    now = 0
    tab = uuid4()
    store = MonitorStore(clock=lambda: now)
    token = visitor_monitor.set(store)
    try:
        for now, bpm in [(0, 77), (1, 85), (6, 93)]:
            store.set(MonitorUpdate.model_validate(update(tab, value=sample(bpm))))
        result, action, change = dispatch("get_live_vitals", {}, MissionPosition(scenario="nominal", day=30))
        assert not action and not change
        result = result["result"]
        assert result["provenance"] == "synthetic_simulation"
        assert result["data"]["sample"]["ecgBpm"] == 93
        assert result["data"]["lastMinute"] == {"sampleCount": 3, "coverageSeconds": 6,
                                                "minEcgBpm": 77, "maxEcgBpm": 93, "changeEcgBpm": 16}
        store.set(MonitorUpdate.model_validate(update(tab, value=sample(), epoch=1)))
        assert store.read()["lastMinute"]["sampleCount"] == 1
        now += 13
        assert store.read()["status"] == "unavailable"
    finally:
        visitor_monitor.reset(token)


def test_api_is_visitor_local_and_never_accepts_usb_data(monkeypatch):
    monkeypatch.setattr(config, "PUBLIC_DEMO", True)
    tab = uuid4()
    with TestClient(app) as first, TestClient(app) as other:
        assert first.get("/api/live-vitals").json()["status"] == "unavailable"
        assert first.post("/api/live-vitals", json=update(tab, value=sample())).status_code == 204
        assert first.get("/api/live-vitals").json()["sample"]["ecgBpm"] == 77
        assert other.get("/api/live-vitals").json()["status"] == "unavailable"
        assert first.post("/api/live-vitals", json=update(tab, "usb", sample())).status_code == 422
        assert first.post("/api/live-vitals", json=update(tab, "usb")).status_code == 204
        assert first.get("/api/live-vitals").json() == {"status": "unavailable", "reason": "usb"}
        assert first.post("/api/live-vitals", json=update(tab, "closed")).status_code == 204
        assert first.post("/api/live-vitals", json=update(tab, value=sample())).status_code == 204
        assert first.get("/api/live-vitals").json()["status"] == "unavailable"
