import asyncio
from collections import deque
from threading import Lock
from time import monotonic
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from . import companion_state as state, config, wellness
from .analytics import calendar, sleep_analysis
from .crew import crew_status
from .gemini import CompanionError, ChatReply, chat
from .live import live
from .live_vitals import MonitorUpdate, monitor
from .mission import overview
from .models import ChatRequest, Checkin, Metric, MissionDay, MoodEntry, Scenario, Span, WorkspaceView
from .simulation import vitals
from .situations import Activation, Situation, Snapshot, active_situations, apply_current_pulse, situations
from .visitors import VisitorMiddleware, visitor_id

app = FastAPI(title="AEGIS BioSystems", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=config.ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
app.add_middleware(VisitorMiddleware)
DEFAULT = Scenario.SHORT_SLEEP


@app.get("/api/config")
def public_config():
    return JSONResponse({"orbitalUiEnabled": config.ORBITAL_UI_ENABLED}, headers={"Cache-Control": "no-store"})


@app.get("/api/health")
def health():
    configured = bool(config.API_KEY)
    return {
        "status": "ok", "simulation": True, "geminiConfigured": configured,
        "geminiStatus": "configured" if configured else "unconfigured",
    }


@app.get("/api/mission")
def mission(scenario: Scenario = DEFAULT, day: MissionDay = 30):
    summary = overview(scenario, day)
    snapshot = active_situations(situations).read()
    if snapshot.heart_rate_bpm is not None:
        rate = summary["metrics"]["heartRate"]
        rate.update(value=snapshot.heart_rate_bpm, state="watch", delta=round(snapshot.heart_rate_bpm - rate["value"] + rate["delta"], 2))
    return {**summary, "reviewedAlerts": state.reviewed_alert_ids(state.MissionPosition(scenario=scenario, day=day))}


@app.get("/api/vitals")
def vital_signs(scenario: Scenario = DEFAULT, metric: Metric = Metric.HEART, range: Span = Span.WEEK, day: MissionDay = 30):
    series = vitals(scenario, metric, range, day)
    return apply_current_pulse(series, metric, range, active_situations(situations).read())


@app.get("/api/crew")
def crew(scenario: Scenario = DEFAULT, day: MissionDay = 30):
    return crew_status(scenario, day)


@app.get("/api/sleep")
def sleep(scenario: Scenario = DEFAULT, day: MissionDay = 30):
    context = state.MissionPosition(scenario=scenario, day=day)
    return {"days": calendar(scenario, day=day), "analysis": sleep_analysis(scenario, day=day),
            "reviewedAlerts": state.reviewed_alert_ids(context)}


@app.get("/api/sleep/analysis")
def analysis(scenario: Scenario = DEFAULT, day: MissionDay = 30):
    return sleep_analysis(scenario, day=day)


@app.get("/api/wellness")
def wellness_history(scenario: Scenario = DEFAULT, day: MissionDay = 30):
    return wellness.summary(scenario, day=day)


def local_origin(request: Request):
    origin = request.headers.get("origin")
    if origin and not config.origin_allowed(origin, request.headers.get("host")):
        raise HTTPException(403, "Origin is not authorized.")


@app.post("/api/live-vitals", status_code=204, dependencies=[Depends(local_origin)])
def update_live_vitals(frame: MonitorUpdate):
    monitor().set(frame)


@app.get("/api/live-vitals")
def live_vitals():
    return JSONResponse(monitor().read(), headers={"Cache-Control": "no-store"})


@app.post("/api/wellness/checkin", response_model=MoodEntry, status_code=201, dependencies=[Depends(local_origin)])
def checkin(rating: Checkin, scenario: Scenario = DEFAULT, day: MissionDay = 30):
    return wellness.record(scenario, rating, day=day)


chat_times = deque()
live_times = deque()
live_visitors: set[str] = set()
rate_lock = Lock()


def limit_chat():
    with rate_lock:
        now = monotonic()
        while chat_times and now - chat_times[0][0] >= 60:
            chat_times.popleft()
        identity = visitor_id.get()
        if len(chat_times) >= 12 or (identity and sum(owner == identity for _, owner in chat_times) >= 4):
            raise HTTPException(429, "Too many requests. Wait a moment and try again.")
        chat_times.append((now, identity))


@app.get("/api/companion/activity", response_model=list[state.Activity])
def activity():
    return state.activity()


@app.post("/api/companion/activity/{activity_id}/undo", response_model=state.Change, dependencies=[Depends(local_origin)])
def undo(activity_id: Annotated[int, Path(gt=0, le=9223372036854775807)]):
    try:
        return state.undo(activity_id)
    except state.StateError as exc:
        raise HTTPException(409, str(exc)) from None


@app.get("/api/simulation", response_model=Snapshot)
def simulation_state():
    return active_situations(situations).read()


@app.post("/api/simulation/{scenario}", response_model=Snapshot, dependencies=[Depends(local_origin)])
@app.post("/api/simulation/{scenario}/reset", response_model=Snapshot, dependencies=[Depends(local_origin)])
def activate_simulation(scenario: Situation, request: Request, activation: Activation | None = None):
    if request.url.path.endswith("/reset") and scenario != Situation.NOMINAL:
        raise HTTPException(422, "Only the nominal situation can be restored.")
    try:
        return active_situations(situations).activate(scenario, (activation or Activation()).event_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@app.post("/api/chat", response_model=ChatReply, dependencies=[Depends(local_origin), Depends(limit_chat)])
def companion(request: ChatRequest):
    try:
        return chat(request)
    except CompanionError as exc:
        raise HTTPException(exc.status, str(exc)) from None


@app.websocket("/api/live")
async def voice(socket: WebSocket, scenario: Scenario = DEFAULT, day: MissionDay = 30,
                ui: Annotated[str | None, Query(max_length=256)] = None,
                session_id: Annotated[str | None, Query(pattern=r"^[0-9a-f-]{36}$")] = None):
    try:
        workspace = WorkspaceView.model_validate_json(ui) if ui else None
    except ValidationError:
        await socket.close(code=1008)
        return
    identity = visitor_id.get()
    if not identity or not config.API_KEY:
        await live(socket, scenario, day, workspace, session_id)
        return
    with rate_lock:
        now = monotonic()
        while live_times and now - live_times[0][0] >= 60:
            live_times.popleft()
        limited = (identity in live_visitors or len(live_visitors) >= 6 or len(live_times) >= 24
                   or sum(owner == identity for _, owner in live_times) >= 6)
        if not limited:
            live_visitors.add(identity)
            live_times.append((now, identity))
    if limited:
        await socket.accept()
        await socket.send_json({"type": "error", "message": "Demo voice limit reached. Close other tabs or wait a minute."})
        await socket.close(code=1008)
        return
    try:
        async with asyncio.timeout(12 * 60):
            await live(socket, scenario, day, workspace, session_id)
    except TimeoutError:
        await socket.close(code=1000, reason="Demo duration limit")
    finally:
        with rate_lock:
            live_visitors.discard(identity)


def serve_frontend(directory, request_path: str):
    if request_path.partition("/")[0] in {"api", "assets", "docs", "redoc", "openapi.json"}:
        raise HTTPException(404)
    # Vite public assets use root URLs; never serve outside the compiled tree.
    root = directory.resolve()
    candidate = (root / request_path).resolve()
    if not candidate.is_relative_to(root):
        raise HTTPException(404)
    if candidate.is_file():
        return FileResponse(candidate)
    if candidate.suffix:
        raise HTTPException(404)
    index = root / "index.html"
    if not index.is_file():
        raise HTTPException(404, "The frontend has not been built.")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


if (config.FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="frontend-assets")


async def frontend_fallback(scope, receive, send):
    if scope["type"] != "http" or scope["method"] not in ("GET", "HEAD"):
        await app.router.not_found(scope, receive, send)
        return
    response = await run_in_threadpool(serve_frontend, config.FRONTEND_DIST, scope["path"].lstrip("/"))
    await response(scope, receive, send)


app.router.default = frontend_fallback
