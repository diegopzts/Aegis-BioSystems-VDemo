from statistics import mean

import pytest
from fastapi.testclient import TestClient

from app import config, wellness
from app.analytics import SleepRules, calendar, sleep_analysis
from app.main import app
from app.models import Scenario
from app.simulation import BASELINE, dataset


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setattr(wellness, "DB_PATH", tmp_path / "checkins.sqlite3")
    with TestClient(app) as client:
        yield client


def test_health(api, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "sentinel-secret")
    response = api.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "simulation": True, "geminiConfigured": True, "geminiStatus": "configured"}
    assert "sentinel-secret" not in response.text
    assert "/api/chat" in app.openapi()["paths"]


@pytest.mark.parametrize("scenario", list(Scenario))
def test_reproducible_and_cross_module_consistency(api, scenario):
    first = dataset(scenario)
    dataset.cache_clear()
    assert first == dataset(scenario)
    path = f"scenario={scenario}"
    mission = api.get(f"/api/mission?{path}").json()
    sleep = api.get(f"/api/sleep?{path}").json()
    wellbeing = api.get(f"/api/wellness?{path}").json()
    assert len(sleep["days"]) == 30
    assert mission["sleep"] == sleep["analysis"] == api.get(f"/api/sleep/analysis?{path}").json()
    assert mission["wellness"] == wellbeing["current"]
    assert sleep["days"][-1]["hours"] == wellbeing["trend"][-1]["sleepHours"]
    for metric in BASELINE:
        daily = api.get(f"/api/vitals?{path}&metric={metric}&range=30d").json()
        weekly = api.get(f"/api/vitals?{path}&metric={metric}&range=7d").json()
        hourly = api.get(f"/api/vitals?{path}&metric={metric}&range=24h").json()
        assert len(daily["points"]) == 30 and len(hourly["points"]) == 24
        assert daily["points"][-7:] == weekly["points"]
        assert daily["points"][-1]["value"] == mission["metrics"][metric]["value"]
        values = [point["value"] for point in hourly["points"]]
        assert (round(sum(values), 2) if metric == "sleepHours" else round(mean(values), 2)) == daily["points"][-1]["value"]
    for day in first:
        assert sum(row["sleepHours"] for row in day["hourly"]) == pytest.approx(day["sleep"]["durationMinutes"] / 60)


def test_sleep_rules():
    scenario = Scenario.SHORT_SLEEP
    days = calendar(scenario)
    result = sleep_analysis(scenario)
    weekly = round(mean(day["durationMinutes"] for day in days[-7:]) / 60, 2)
    monthly = round(mean(day["durationMinutes"] for day in days) / 60, 2)
    assert result["weeklyAverage"] == weekly
    assert result["monthlyAverage"] == monthly
    assert result["streak"] == 5 and result["trend"] == "falling"
    assert result["recommendations"][0]["days"] == [26, 27, 28, 29, 30]
    assert 28 in result["attentionDays"]
    assert sleep_analysis(Scenario.SHIFT)["irregularDays"] == list(range(24, 31))
    assert sleep_analysis(Scenario.RECOVERY)["trend"] == "rising"
    assert sleep_analysis(scenario, SleepRules(short_minutes=300))["streak"] == 0


def test_persistence_and_validation(api):
    for invalid in ({"stress": 6}, {"mood": "4"}, {"unknown": 2}, {"notes": "x" * 601}):
        data = {"mood": 4, "stress": 3, "energy": 2, **invalid}
        assert api.post("/api/wellness/checkin", json=data).status_code == 422
    assert api.get("/api/vitals?range=invalid").status_code == 422
    rating = {"mood": 4, "stress": 5, "energy": 2, "notes": "Local reflection"}
    saved = api.post("/api/wellness/checkin", json=rating)
    assert saved.status_code == 201
    assert saved.json()["source"] == "checkin"
    latest = api.post("/api/wellness/checkin", json={**rating, "stress": 4}).json()
    # A fresh HTTP client and fresh SQLite connection read the same persisted entry.
    with TestClient(app) as refreshed:
        history = refreshed.get("/api/wellness").json()
        assert history["current"] == history["history"][0] == latest
        assert history["history"][1] == saved.json()
        assert history["trend"][-1]["stress"] == 4
        assert refreshed.get("/api/mission").json()["wellness"]["notes"] == ""
        assert refreshed.get("/api/wellness?scenario=nominal").json()["current"]["source"] == "simulated"


def test_mood_only_checkin_is_persisted_without_fabricating_ratings(api):
    response = api.post("/api/wellness/checkin", json={"mood": 4, "notes": "Una tarde tranquila."})
    assert response.status_code == 201
    entry = response.json()
    assert entry["stress"] is None and entry["energy"] is None
    assert api.get("/api/wellness").json()["history"][0] == entry
    assert api.post("/api/wellness/checkin", json={"mood": 4, "energy": 0}).status_code == 422
    assert api.post("/api/wellness/checkin", json={"mood": 4, "notes": "x" * 601}).status_code == 422
