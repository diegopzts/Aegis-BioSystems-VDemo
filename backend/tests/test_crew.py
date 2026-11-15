from fastapi.testclient import TestClient

from app.companion_state import MissionPosition
from app.companion_tools import dispatch
from app.main import app


def test_crew_panel_and_companion_share_the_roster_without_private_checkins():
    with TestClient(app) as client:
        roster = client.get("/api/crew?scenario=nominal&day=10").json()
        mission = client.get("/api/mission?scenario=nominal&day=10").json()
    members = roster["members"]
    assert len(members) == 6
    assert {row["status"] for row in members} == {"active", "resting", "exercising", "off_duty", "pending"}
    assert members[0]["heartRate"] == mission["metrics"]["heartRate"]["value"]
    assert members[0]["sleepHours"] == mission["metrics"]["sleepHours"]["value"]
    assert all("notes" not in row and "messages" not in row for row in members)
    result, _, _ = dispatch("get_crew_status", {}, MissionPosition(scenario="nominal", day=10), {"crewId": "AST-03"})
    assert result["result"]["data"] == {**roster, "selectedCrewId": "AST-03"}


def test_relax_actions_are_validated_with_existing_control_tool():
    context = MissionPosition(scenario="nominal", day=10)
    for action in ({"type": "relax", "command": "open_memory"}, {"type": "orbit"}, {"type": "navigate", "section": "crew"}):
        _, applied, _ = dispatch("control_ui", {"action": action}, context)
        assert applied.model_dump() == action
    result, applied, _ = dispatch("control_ui", {"action": {"type": "relax", "command": "execute", "code": "test"}}, context)
    assert "error" in result and applied is None
