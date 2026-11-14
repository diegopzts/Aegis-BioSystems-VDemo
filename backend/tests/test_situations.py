import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from google.genai import types

from app import companion_tools, live, main, wellness
from app.companion_state import MissionPosition
from app.models import Scenario
from app.situations import Situation, SituationStore


@pytest.fixture
def store(monkeypatch, tmp_path):
    state = SituationStore()
    for module in (main, live, companion_tools):
        monkeypatch.setattr(module, "situations", state)
    monkeypatch.setattr(wellness, "DB_PATH", tmp_path / "test.sqlite")
    return state


def test_scenarios_idempotency_and_nominal(store):
    with TestClient(main.app) as api:
        def activate(name, event):
            return api.post(f"/api/simulation/{name}", json={"event_id": event}).json()

        panic = activate("panic_bio_sync", "p1")
        assert panic["active_mode"] == "breathing_sync" and panic["heart_rate_bpm"] == 148
        assert panic["stress_proxy"] == 89 and panic["habitat"]["oxygen_percent"] == 20.9
        assert activate("panic_bio_sync", "p1") == panic
        assert api.get("/api/mission").json()["metrics"]["heartRate"]["value"] == 148
        assert api.get("/api/vitals").json()["points"][-1]["value"] == 148
        leak = activate("o2_leak_zero_ui", "l1")
        assert (leak["habitat"]["oxygen_percent"], leak["habitat"]["co2_ppm"], leak["habitat"]["pressure_kpa"]) == (16.4, 1850, 84.5)
        assert activate("panic_bio_sync", "p1") == leak
        isolated = activate("extreme_isolation", "i1")
        assert (isolated["mission_day"], isolated["communication_delay_minutes"]) == (142, 21)
        assert len(api.get("/api/sleep").json()["days"]) == 30
        murphy = activate("mars_murphy", "m1")
        assert murphy["habitat"]["dust_storm"] and murphy["habitat"]["oxygen_percent"] == 15.8
        assert murphy["heart_rate_bpm"] == 162 and murphy["breathing_guide"]
        nominal = activate("nominal/reset", "n1")
        assert nominal["active_mode"] == "standard" and not nominal["pending_live"] and not nominal["actions"]
        assert api.get("/api/simulation").json() == nominal
        assert api.post("/api/simulation/invalid").status_code == 422


def test_typed_tools_change_only_current_local_situation(store):
    scenario = store.activate(Situation.LEAK, "leak")
    context = MissionPosition(scenario=Scenario.NOMINAL, day=30)

    def call(name, args, event="leak"):
        return companion_tools.dispatch(name, args, context, event_id=event)[0]

    assert "error" in call("seal_habitat_sector", {"sector_id": "hardware"})
    assert "error" in call("set_cabin_lighting", {"percent": 101})
    assert "error" in call("seal_habitat_sector", {"sector_id": "A"}, "stale")
    result = call("stabilize_simulated_environment", {"actions": ["seal_b", "reserve_high", "dim_lights"]})["result"]
    assert result["version"] == scenario.version + 1
    assert result["habitat"]["sealed_sectors"] == ["B"]
    assert result["habitat"]["oxygen_reserve"] == "high"
    assert result["habitat"]["lighting_percent"] == 15
    assert call("seal_habitat_sector", {"sector_id": "B"})["result"] == result
    assert call("get_simulation_state", {})["result"]["data"] == result
    store.activate(Situation.NOMINAL, "reset")
    assert "error" in call("set_cabin_lighting", {"percent": 15})


def test_pending_turn_is_injected_once_without_microphone(store):
    async def run():
        store.activate(Situation.ISOLATION, "old")
        store.activate(Situation.NOMINAL, "reset")
        store.activate(Situation.PANIC, "new")
        sent = []
        snapshots = []
        done = asyncio.Event()

        class Socket:
            async def receive(self):
                await done.wait()
                raise WebSocketDisconnect

            async def send_json(self, value):
                if value["type"] == "simulation":
                    snapshots.append(value)
                    if not value["snapshot"]["pending_live"]:
                        done.set()

            async def send_bytes(self, value):
                assert value == b"\x01\x00"

        class Session:
            async def receive(self):
                await started.wait()
                yield types.LiveServerMessage(server_content=types.LiveServerContent(
                    model_turn=types.Content(parts=[types.Part(inline_data=types.Blob(
                        mime_type="audio/pcm;rate=24000", data=b"\x01\x00"))])))
                await asyncio.Future()

            async def send_client_content(self, *, turns, turn_complete):
                assert isinstance(turns, types.Content) and turn_complete
                sent.append(turns.parts[0].text)
                assert store.read().pending_live
                started.set()

        started = asyncio.Event()
        with pytest.raises(WebSocketDisconnect):
            await asyncio.wait_for(live.bridge(Socket(), Session(), Scenario.NOMINAL), 2)
        assert len(sent) == 1 and "6 ciclos/min" in sent[0]
        assert [frame["snapshot"]["event_id"] for frame in snapshots] == ["new", "new"]
        assert not store.read().pending_live

    asyncio.run(run())



@pytest.mark.parametrize(("scenario", "ending"), [
    (Situation.PANIC, "Estoy aquí contigo; avisando a torre."),
    (Situation.LEAK, "Avisando a torre. Iniciando protocolo simulado."),
    (Situation.ISOLATION, "Estoy aquí para escucharte."),
    (Situation.MURPHY, "Avisando a torre. Estabilizando hábitat simulado."),
])
def test_scenario_narrative_is_shared_with_live(store, scenario, ending):
    snapshot = store.activate(scenario, "narrative-test")
    expected = "Anomalía detectada. Respire con calma. Inhala… exhala… " + ending
    assert snapshot.narrative == expected
    assert f"«{expected}»" in live.prompt(snapshot)
    assert store.activate(Situation.NOMINAL, "reset").narrative is None


def test_greeting_sent_once_for_logical_session_across_reconnect(store, monkeypatch):
    monkeypatch.setattr(live, "GREETED", {})
    sent = []

    async def connect(session_id):
        class Socket:
            async def receive(self):
                await self.done.wait()
                raise WebSocketDisconnect

            async def send_json(self, value):
                self.done.set()

        class Session:
            async def receive(self):
                await asyncio.Event().wait()
                yield

            async def send_realtime_input(self, *, text):
                sent.append(text)

        socket = Socket()
        socket.done = asyncio.Event()
        with pytest.raises(WebSocketDisconnect):
            await asyncio.wait_for(live.bridge(socket, Session(), Scenario.NOMINAL, session_id=session_id), 2)

    async def run():
        await connect("logical-first")
        await connect("logical-first")
        await connect("logical-second")

    asyncio.run(run())
    assert sent == [live.greeting_instruction(), live.greeting_instruction()]


def test_orbital_telemetry_is_consistent_across_situations_and_reset(store):
    with TestClient(main.app) as api:
        nominal = api.get("/api/simulation").json()["orbital"]
        assert nominal["synthetic"] is True
        assert nominal["one_way_seconds"] == round(nominal["distance_million_km"] * 1e6 / 299792.458)
        assert nominal["one_way_label"] == "21 min 00 s"
        assert nominal["link_status"] == "normal" and not nominal["autonomous_override"]
        for scenario in Situation:
            if scenario == Situation.NOMINAL:
                continue
            response = api.post(f"/api/simulation/{scenario}", json={"event_id": scenario.value})
            assert response.status_code == 200
            assert response.json()["orbital"] == {**nominal, "link_status": "warning",
                "link_label": "SIN RESPUESTA EN TIEMPO REAL", "autonomous_override": True}
        assert api.post("/api/simulation/nominal/reset").json()["orbital"] == nominal


def test_narration_keeps_audio_around_tools_and_waits_before_sending_next_prompt(store):
    async def run():
        inbound = asyncio.Queue()
        outbound = asyncio.Queue()
        prompts = []
        tool_responses = []

        class Socket:
            async def receive(self):
                await asyncio.Future()

            async def send_json(self, value):
                await outbound.put(value)

            async def send_bytes(self, value):
                await outbound.put(value)

        class Session:
            async def receive(self):
                while True:
                    event = await inbound.get()
                    yield event
                    if event.server_content and event.server_content.turn_complete:
                        return

            async def send_client_content(self, *, turns, turn_complete):
                assert turn_complete
                prompts.append(turns.parts[0].text)

            async def send_tool_response(self, *, function_responses):
                tool_responses.extend(function_responses)

        def content(**kwargs):
            return types.LiveServerMessage(server_content=types.LiveServerContent(**kwargs))

        def audio(payload):
            return content(model_turn=types.Content(parts=[types.Part(inline_data=types.Blob(
                mime_type="audio/pcm;rate=24000", data=payload))]))

        async def frame_of(kind):
            while True:
                value = await asyncio.wait_for(outbound.get(), 2)
                if isinstance(value, dict) and value["type"] == kind:
                    return value

        async def audio_is(payload, turn, narrative):
            info = await frame_of("audio_chunk")
            assert (info["session_id"], info["turn"], info["narrative_id"]) == ("session-test", turn, narrative)
            assert await asyncio.wait_for(outbound.get(), 2) == payload

        store.activate(Situation.LEAK, "leak")
        task = asyncio.create_task(live.bridge(Socket(), Session(), Scenario.NOMINAL, session_id="session-test"))
        try:
            assert (await frame_of("narrative_start"))["turn"] == 1
            await inbound.put(audio(b"\x01\x00"))
            await audio_is(b"\x01\x00", 1, "leak")
            await inbound.put(types.LiveServerMessage(tool_call=types.LiveServerToolCall(function_calls=[
                types.FunctionCall(name="seal_habitat_sector", id="seal", args={"sector_id": "B"}),
            ])))
            await inbound.put(audio(b"\x02\x00"))
            await audio_is(b"\x02\x00", 1, "leak")
            assert tool_responses[0].id == "seal"
            assert store.read().habitat.sealed_sectors == ["B"]

            store.activate(Situation.PANIC, "panic")
            while (await frame_of("simulation"))["snapshot"]["event_id"] != "panic":
                pass
            assert len(prompts) == 1
            await inbound.put(audio(b"\x03\x00"))
            await audio_is(b"\x03\x00", 1, "leak")
            await inbound.put(content(generation_complete=True))
            assert (await frame_of("generation_end"))["turn"] == 1
            assert len(prompts) == 1
            await inbound.put(content(turn_complete=True))
            assert (await frame_of("turn_end"))["turn"] == 1
            replacement = await frame_of("narrative_start")
            assert (replacement["turn"], replacement["narrative_id"]) == (2, "panic")
            await inbound.put(audio(b"\x04\x00"))
            await audio_is(b"\x04\x00", 2, "panic")
            await inbound.put(content(generation_complete=True))
            assert (await frame_of("generation_end"))["turn"] == 2
            await inbound.put(content(turn_complete=True))
            assert (await frame_of("turn_end"))["turn"] == 2
            assert len(prompts) == 2
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run())
