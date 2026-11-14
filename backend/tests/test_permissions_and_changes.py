from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from google.genai import errors, types

from app import companion_state as state, gemini, wellness
from app.companion_tools import dispatch
from app.main import app, chat_times
from app.models import Checkin, Scenario

CONTEXT = state.MissionPosition(scenario=Scenario.SHORT_SLEEP, day=30)
CHECKIN = {"mood": 2, "stress": 4, "energy": 3}
NOTE = "Private marker for test"


@pytest.fixture(autouse=True)
def local_storage(monkeypatch, tmp_path):
    monkeypatch.setattr(wellness, "DB_PATH", tmp_path / "local.sqlite3")
    chat_times.clear()
    yield
    chat_times.clear()


def call(name, args=None, context=CONTEXT, **options):
    return dispatch(name, args or {}, context, **options)


def test_read_tools_expose_existing_domains_with_bounded_results():
    wellness.record(CONTEXT.scenario, Checkin(**CHECKIN, notes=NOTE))
    result = call("get_full_mission_context")[0]["result"]["data"]
    assert set(result) == {"get_mission_overview", "get_vitals_summary", "get_wellness_summary", "analyze_sleep", "get_alerts"}
    assert NOTE not in str(result)
    assert call("get_mission_overview")[0]["result"]["data"]["day"] == 30
    assert len(call("get_vitals_summary", {"metric": "heartRate", "range": "24h", "day": 5})[0]["result"]["data"]["points"]) == 24
    assert call("get_sleep_records", {"period": "7d", "days": [1]})[0]["result"]["data"][0]["day"] == 1
    assert call("get_wellness_entries", {"limit": 1})[0]["result"]["data"][0]["notes"] == NOTE
    assert "notes" not in call("get_wellness_entries", {"limit": 1, "include_notes": False})[0]["result"]["data"][0]
    assert len(call("get_simulator_state", ui={"section": "body"})[0]["result"]["data"]["scenarios"]) == 5


@pytest.mark.parametrize(("name", "args"), [
    ("execute_sql", {"sql": "SELECT 1"}),
    ("create_wellness_entry", {"mood": 8, "stress": 2, "energy": 2}),
    ("update_wellness_entry", {"id": 20, "stress": 4}),
    ("delete_wellness_entry", {"id": 20}),
    ("set_mission_scenario", {"scenario": "arbitrary"}),
    ("control_ui", {"action": {"type": "navigate", "section": "https://example.com"}}),
    ("get_wellness_entries", {"limit": 12, "permission": "always"}),
    ("advance_mission", {}),
])
def test_invalid_tools_return_error_and_no_mutation(name, args):
    result, _, change = call(name, args)
    assert "error" in result and change is None
    assert not state.activity()


def test_direct_create_edit_delete_and_undo_use_database():
    saved = call("create_wellness_entry", {**CHECKIN, "notes": NOTE})[2]
    entry_id = saved.record["id"]
    assert call("update_wellness_entry", {"id": entry_id, "stress": 5})[2].record["stress"] == 5
    assert call("delete_wellness_entry", {"id": entry_id})[2].record["deleted"]
    assert not wellness.manual_entries(CONTEXT.scenario, 30, 10, False)
    assert "error" in call("delete_wellness_entry", {"id": entry_id})[0]
    activity = call("get_activity")[0]["result"]["data"]
    assert NOTE not in str(activity) and activity[0]["undoable"] and activity[0]["entry_id"] == entry_id
    restored = call("undo_change", {"id": activity[0]["id"]})[2]
    assert restored.record == {"id": entry_id, "deleted": False}
    with TestClient(app) as api:
        assert api.get("/api/wellness").json()["current"]["stress"] == 5
        assert api.get("/api/companion/permissions").status_code == 404
        assert api.post("/api/companion/confirm", json={}).status_code == 404
        assert api.post("/api/companion/activity/1/undo", headers={"origin": "https://example.com"}).status_code == 403


def test_mission_position_and_alert_review_are_coherent():
    first_alert = call("get_alerts")[0]["result"]["data"]["current"][0]
    call("acknowledge_alert", {"id": first_alert["id"]})
    alerts = call("get_alerts")[0]["result"]["data"]
    assert alerts["current"][0] == {**first_alert, "reviewed": True}
    assert alerts["reviewHistory"][0]["alert_id"] == first_alert["id"]
    pos = state.MissionPosition.model_validate(call("reset_mission")[2].record)
    assert call("advance_mission", context=pos)[2].record["day"] == 2
    with TestClient(app) as api:
        query = "?scenario=nominal&day=1"
        assert api.get("/api/mission" + query).json()["day"] == 1
        assert len(api.get("/api/sleep" + query).json()["days"]) == 1
        assert len(api.get("/api/vitals" + query).json()["points"]) == 1
        assert api.get("/api/wellness" + query).json()["current"]["day"] == 1


@pytest.mark.parametrize("success", [False, True])
def test_chat_reports_real_commit_after_provider_failure_and_never_retries_write(monkeypatch, success):
    seen = []

    def generate_content(model, contents, config):
        seen.append(model)
        if len(contents) == 1:
            args = CHECKIN if success else {**CHECKIN, "stress": 9}
            part = types.Part(function_call=types.FunctionCall(name="create_wellness_entry", args=args))
            return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[part]))])
        result = contents[-1].parts[0].function_response.response
        assert ("result" in result) == success
        raise errors.ClientError(429, {"error": {"message": "mock quota"}})

    @contextmanager
    def fake_client():
        yield SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(gemini, "client", fake_client)
    monkeypatch.setattr(gemini, "candidates", lambda kind: ("mock", "fallback"))
    with TestClient(app) as api:
        response = api.post("/api/chat", json={"messages": [{"role": "user", "text": "Guarda ánimo 2, estrés 4 y energía 3."}]})
    assert response.status_code == (200 if success else 429)
    if success:
        assert response.json()["changes"][0]["operation"] == "create_wellness_entry"
    assert len(wellness.manual_entries(CONTEXT.scenario, 30, 10, True)) == int(success)
    assert seen == ["mock", "mock"]

