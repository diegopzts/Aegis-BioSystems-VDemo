import asyncio
from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from google.genai import errors, types
import httpx

from app import companion_state, config, gemini, wellness
from app.live import pcm_format
from app.main import chat_times
from app.companion_tools import dispatch
from app.live import bridge
from app.main import app
from app.models import Scenario

ORIGIN = {"origin": "http://127.0.0.1:5173"}
BODY = {"messages": [{"role": "user", "text": "¿Cómo he dormido?"}]}


@pytest.fixture(autouse=True)
def isolate_companion(monkeypatch, tmp_path):
    monkeypatch.setattr(wellness, "DB_PATH", tmp_path / "aegis.sqlite3")
    chat_times.clear()
    yield
    chat_times.clear()


def test_action_allowlist():
    context = companion_state.MissionPosition(scenario=Scenario.SHORT_SLEEP, day=30)
    result, action, _ = dispatch("control_ui", {"action": {
        "type": "viewer", "region": "chest", "view": "right",
    }}, context)
    assert result["result"] and action.model_dump() == {"type": "viewer", "region": "chest", "view": "right"}
    for name, args in [
        ("execute", {"cmd": "echo"}), ("set_body_view", {"region": "/tmp", "view": "front"}),
        ("set_chart", {"metric": "heartRate", "range": "7d", "extra": True}),
        ("get_sleep_summary", {"extra": 3}), ("navigate_to_section", {"section": "body", "type": "viewer"}),
    ]:
        result, action, _ = dispatch(name, args, context)
        assert action is None and "error" in result


def response(part):
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[part])
    )])


def test_text_tool_flow_and_fallback(monkeypatch):
    monkeypatch.setattr(gemini, "candidates", lambda kind: ("model-a", "model-b"))
    gate = types.Part(function_call=types.FunctionCall(name="analyze_sleep", args={}))
    structured = '{"reply":"La semana promedió 6.55 h."}'
    call_log = []

    def generate_content(model, contents, config):
        call_log.append(model)
        if model == "model-a":
            raise errors.ServerError(503, {"error": {"message": "unavailable"}})
        if config.response_mime_type == "application/json":
            assert config.response_schema.model_dump(exclude_none=True) == {
                "type": types.Type.OBJECT,
                "properties": {"reply": {"type": types.Type.STRING}},
                "required": ["reply"],
            }
            return response(types.Part(text=structured))
        if len(contents) == 1:
            return response(gate)
        tool_value = contents[-1].parts[0].function_response.response["result"]
        assert tool_value["data"]["streak"] == 5 and tool_value["data"]["weeklyAverage"] == 6.55
        return response(types.Part(text="Completed using tool data"))

    @contextmanager
    def fake_client():
        yield SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(gemini, "client", fake_client)
    with TestClient(app) as api:
        reply = api.post("/api/chat", json=BODY)
    assert reply.status_code == 200
    assert reply.json() == {"reply": "La semana promedió 6.55 h.", "model": "model-b", "actions": [],
                            "changes": [], "sources": ["analyze_sleep"]}
    assert call_log == ["model-a", "model-b", "model-b", "model-b"]


def test_provider_errors_and_missing_key(monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "")
    with TestClient(app) as api:
        assert api.get("/api/health").json()["geminiStatus"] == "unconfigured"
        response = api.post("/api/chat", json=BODY)
        assert response.status_code == 503
        assert "backend/.env" in response.json()["detail"]
        assert api.get("/api/sleep/analysis").status_code == 200
        assert api.post("/api/chat", json={"messages": [{"role": "assistant", "text": "hi"}]}).status_code == 422
        with api.websocket_connect("/api/live", headers=ORIGIN) as socket:
            assert socket.receive_json()["type"] == "error"
        with pytest.raises(WebSocketDisconnect), api.websocket_connect("/api/live", headers={"origin": "https://invalid.example"}):
            pass


@pytest.mark.parametrize(("failure", "status", "message"), [
    (errors.ClientError(400, {"error": {"details": [{"reason": "API_KEY_INVALID"}]}}), 503, "denied access"),
    (errors.ClientError(403, {"error": {"message": "provider-secret-sentinel"}}), 503, "denied access"),
    (errors.ClientError(429, {"error": {"message": "provider-secret-sentinel"}}), 429, "quota"),
    (errors.ClientError(404, {"error": {"message": "provider-secret-sentinel"}}), 503, "model"),
    (httpx.ReadTimeout("provider-secret-sentinel"), 504, "too long"),
    (httpx.ConnectError("provider-secret-sentinel"), 503, "Internet"),
    (errors.ServerError(503, {"error": {"message": "provider-secret-sentinel"}}), 503, "temporarily unavailable"),
])
def test_chat_provider_errors_are_safe(monkeypatch, caplog, failure, status, message):
    def generate_content(**kwargs):
        raise failure

    @contextmanager
    def fake_client():
        yield SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(config, "API_KEY", "configured-secret-sentinel")
    monkeypatch.setattr(config, "TEXT_MODEL", "test-model")
    monkeypatch.setattr(gemini, "client", fake_client)
    with TestClient(app) as api:
        assert api.get("/api/health").json()["geminiStatus"] == "configured"
        response = api.post("/api/chat", json=BODY)
    assert response.status_code == status
    assert message in response.json()["detail"]
    assert "secret-sentinel" not in response.text and "secret-sentinel" not in caplog.text


def test_config_reads_backend_dotenv_from_any_cwd(monkeypatch, tmp_path):
    import runpy

    backend = tmp_path / "backend"
    app_dir = backend / "app"
    app_dir.mkdir(parents=True)
    config_copy = app_dir / "config.py"
    config_copy.write_bytes(config.ENV_FILE.parent.joinpath("app", "config.py").read_bytes())
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    path = backend / ".env"
    assert not runpy.run_path(str(config_copy))["API_KEY"]
    path.write_text('GEMINI_API_KEY="   "\n', encoding="utf-8-sig")
    assert not runpy.run_path(str(config_copy))["API_KEY"]
    path.write_text("GEMINI_API_KEY=local-sentinel\nGEMINI_LIVE_MODEL=auto\n", encoding="utf-8-sig")
    result = runpy.run_path(str(config_copy))
    assert result["API_KEY"] == "local-sentinel"
    assert result["TEXT_MODEL"] == config.DEFAULT_TEXT_MODEL
    assert result["LIVE_MODEL"] == "auto"
    monkeypatch.setenv("AEGIS_ORBITAL_UI_ENABLED", "1")
    assert runpy.run_path(str(config_copy))["ORBITAL_UI_ENABLED"] is True
    monkeypatch.setenv("AEGIS_ORBITAL_UI_ENABLED", "0")
    assert runpy.run_path(str(config_copy))["ORBITAL_UI_ENABLED"] is False
    monkeypatch.setenv("GEMINI_API_KEY", "environment-sentinel")
    assert runpy.run_path(str(config_copy))["API_KEY"] == "environment-sentinel"
    monkeypatch.setenv("GEMINI_API_KEY", " ")
    assert not runpy.run_path(str(config_copy))["API_KEY"]


@pytest.mark.parametrize(("mime", "expected"), [
    ("audio/pcm", (24000, 1)), ("audio/pcm;rate=32000;channels=1", (32000, 1)),
    ("audio/pcm;rate=16000;channels=2", None), ("audio/wav", None),
])
def test_output_pcm_format(mime, expected):
    assert pcm_format(mime) == expected


def test_live_mock_websocket_and_provider_cleanup(monkeypatch):
    from app import live
    closed = []

    class Session:
        def __init__(self):
            self.ready = asyncio.Event()

        async def send_realtime_input(self, *, audio):
            assert audio.mime_type == "audio/pcm;rate=16000" and audio.data == b"\x00\x01"
            self.ready.set()

        async def receive(self):
            await self.ready.wait()
            self.ready.clear()
            yield types.LiveServerMessage(server_content=types.LiveServerContent(
                input_transcription=types.Transcription(text="Hola", finished=True),
                output_transcription=types.Transcription(text="Qué tal", finished=True),
                model_turn=types.Content(parts=[types.Part(inline_data=types.Blob(
                    mime_type="audio/pcm;rate=24000", data=b"\x02\x03",
                ))]), turn_complete=True,
            ))

    @asynccontextmanager
    async def connect(**kwargs):
        try:
            yield Session()
        finally:
            closed.append("session")

    @asynccontextmanager
    async def aio():
        try:
            yield SimpleNamespace(live=SimpleNamespace(connect=connect))
        finally:
            closed.append("client")

    monkeypatch.setattr(live, "candidates", lambda kind: ("test-model",))
    monkeypatch.setattr(live, "client", lambda: SimpleNamespace(aio=aio()))
    with TestClient(app) as api:
        with api.websocket_connect("/api/live", headers=ORIGIN) as socket:
            assert socket.receive_json() == {"type": "state", "value": "listening"}
            assert socket.receive_json()["type"] == "simulation"
            socket.send_bytes(b"\x00\x01")
            assert socket.receive_json() == {"type": "transcript", "turn": 1, "role": "user", "text": "Hola", "finished": True}
            assert socket.receive_json() == {"type": "transcript", "turn": 1, "role": "assistant", "text": "Qué tal", "finished": True}
            assert socket.receive_json() == {"type": "state", "value": "responding"}
            assert socket.receive_json() == {"type": "audio_format", "rate": 24000, "channels": 1}
            assert socket.receive_bytes() == b"\x02\x03"
            assert socket.receive_json() == {"type": "turn_end", "turn": 1}
            socket.send_bytes(b"\x00")
            assert socket.receive()["code"] == 1003
    assert closed == ["session", "client"]


def test_bridge_cancels_peer_on_disconnect():
    cancelled = []

    class Socket:
        async def send_json(self, value):
            pass

        async def receive(self):
            await asyncio.sleep(0)
            raise WebSocketDisconnect()

    class Session:
        async def receive(self):
            try:
                await asyncio.Event().wait()
                yield None
            finally:
                cancelled.append(True)

    with pytest.raises(WebSocketDisconnect):
        asyncio.run(bridge(Socket(), Session(), Scenario.NOMINAL))
    assert cancelled == [True]
