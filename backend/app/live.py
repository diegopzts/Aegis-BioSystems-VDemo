import asyncio
import re
from contextlib import asynccontextmanager
from time import monotonic
from pydantic import ValidationError

from fastapi import WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from google.genai import types

from . import config
from .gemini import CompanionError, SYSTEM, candidates, client, provider_error, provider_reason
from .companion_state import MissionPosition
from .companion_tools import TOOLS, declarations, dispatch
from .models import Scenario, StrictModel, WorkspaceView
from .situations import Situation, active_situations, prompt, situations

GREETING = "How are you feeling today?"
GREETED: dict[str, float] = {}


def claim_greeting(session_id: str | None) -> bool:
    if not session_id:
        return False
    now = monotonic()
    while GREETED and now - next(iter(GREETED.values())) > 86400:
        del GREETED[next(iter(GREETED))]
    if session_id in GREETED:
        return False
    if len(GREETED) >= 2048:
        del GREETED[next(iter(GREETED))]
    GREETED[session_id] = now
    return True


def greeting_instruction():
    return f"Speak this exact greeting in English, with no introduction: «{GREETING}»."


PCM_PARAM = re.compile(r'(rate|channels)\s*=\s*"?([0-9]{1,6})"?', re.I)


def pcm_format(mime_type: str):
    kind, *params = mime_type.split(";")
    if kind.strip().lower() != "audio/pcm":
        return None
    values = {}
    for param in params:
        match = PCM_PARAM.fullmatch(param.strip())
        if not match or match[1].lower() in values or param.count('"') == 1:
            return None
        values[match[1].lower()] = int(match[2])
    rate = values.get("rate", 24000)
    channels = values.get("channels", 1)
    return (rate, channels) if 8000 <= rate <= 96000 and channels == 1 else None


class WorkspaceUpdate(StrictModel):
    position: MissionPosition
    ui: WorkspaceView


class ReconnectLive(Exception):
    pass


async def bridge(socket: WebSocket, session, scenario: Scenario, day: int = 30, ui: WorkspaceView | None = None, model: str = "gemini-3.8-live", session_id: str | None = None):
    store = active_situations(situations)
    context = MissionPosition(scenario=scenario, day=day)
    changed = False
    turn = 1
    chunk_sequence = 0
    narrative_id = None
    claimed_event = None
    attempted_event = None
    interrupted = False
    speech_ids = set()
    audio_format = None
    delivered_event = None
    provider_send = asyncio.Lock()
    initial = store.read()
    initial_version = initial.version
    initial_nominal = initial.scenario_id == Situation.NOMINAL
    turn_event = initial.event_id
    idle = asyncio.Event()
    idle.set()
    habitat_calls = 0
    first_snapshot = True

    async def upload():
        nonlocal context, ui
        while True:
            frame = await socket.receive()
            if frame["type"] == "websocket.disconnect":
                raise WebSocketDisconnect
            if frame.get("text") is not None:
                try:
                    if len(frame["text"]) > 512:
                        raise ValueError
                    update = WorkspaceUpdate.model_validate_json(frame["text"])
                    context, ui = update.position, update.ui
                except (ValidationError, ValueError):
                    await socket.close(code=1003)
                    return
                continue
            audio = frame.get("bytes")
            if not audio or len(audio) > 32768 or len(audio) % 2:
                await socket.close(code=1003)
                return
            async with provider_send:
                await session.send_realtime_input(audio=types.Blob(data=audio, mime_type="audio/pcm;rate=16000"))

    def turn_meta():
        return {"session_id": session_id, "turn": turn, "narrative_id": narrative_id, "event_id": turn_event}

    @asynccontextmanager
    async def idle_writer():
        while True:
            await idle.wait()
            await provider_send.acquire()
            if idle.is_set():
                break
            provider_send.release()
        try:
            yield
        finally:
            provider_send.release()

    async def publish_situations(queue):
        nonlocal delivered_event, turn_event, first_snapshot, narrative_id, claimed_event, attempted_event
        while True:
            snapshot = await queue.get()
            changed_event = snapshot.event_id != delivered_event
            if changed_event:
                delivered_event = snapshot.event_id
            await socket.send_json({"type": "simulation", "snapshot": snapshot.model_dump(mode="json")})
            if not changed_event and not first_snapshot:
                continue
            # A complete client turn can interrupt Gemini. Keep the current turn and
            # its PCM intact; the store retains the latest request until Live is idle.
            async with idle_writer():
                if snapshot.event_id != store.read().event_id:
                    continue
                turn_event = snapshot.event_id
                if changed_event and snapshot.scenario_id == Situation.NOMINAL and (snapshot.version > initial_version or not initial_nominal):
                    notice = "The previous simulation ended. Continue in nominal mode with no habitat actions or restoration announcement."
                    if "3.8-live" in model:
                        await session.send_client_content(
                            turns=types.Content(role="user", parts=[types.Part(text=notice)]), turn_complete=False,
                        )
                greet = first_snapshot and claim_greeting(session_id)
                first_snapshot = False
                if attempted_event != snapshot.event_id and store.claim(snapshot.event_id):
                    claimed_event = attempted_event = narrative_id = snapshot.event_id
                    idle.clear()
                    try:
                        text = prompt(snapshot)
                        if greet:
                            text += f' After the opening narrative, ask once: «{GREETING}».'
                        await socket.send_json({"type": "narrative_start", **turn_meta()})
                        if "3.8-live" in model:
                            await session.send_client_content(
                                turns=types.Content(role="user", parts=[types.Part(text=text)]), turn_complete=True,
                            )
                        else:
                            await session.send_realtime_input(text=text)
                    except BaseException:
                        if greet and session_id:
                            GREETED.pop(session_id, None)
                        raise
                elif greet:
                    try:
                        idle.clear()
                        if session_id:
                            await socket.send_json({"type": "state", "value": "responding", **turn_meta()})
                        await session.send_realtime_input(text=greeting_instruction())
                    except BaseException:
                        if session_id:
                            GREETED.pop(session_id, None)
                        raise

    async def download():
        nonlocal turn, changed, context, audio_format, habitat_calls
        nonlocal narrative_id, claimed_event, chunk_sequence, interrupted
        while True:
            received = False
            async for message in session.receive():
                received = True
                if message.go_away:
                    await socket.send_json({"type": "provider_closing", **turn_meta()})
                if message.tool_call_cancellation:
                    speech_ids.update(message.tool_call_cancellation.ids or [])
                content = message.server_content
                if content:
                    if content.model_turn or content.output_transcription or content.generation_complete:
                        idle.clear()
                    if content.interrupted and not interrupted and not idle.is_set():
                        interrupted = True
                        await socket.send_json({"type": "interrupt", **turn_meta()})
                    for role, transcript in (("user", content.input_transcription), ("assistant", content.output_transcription)):
                        if transcript and transcript.text and not (config.API_KEY and config.API_KEY in transcript.text):
                            await socket.send_json({"type": "transcript", **(turn_meta() if session_id else {"turn": turn}), "role": role,
                                                    "text": transcript.text[:2000], "finished": bool(transcript.finished)})
                    if content.input_transcription and content.input_transcription.finished:
                        idle.clear()
                        await socket.send_json({"type": "state", "value": "responding", **(turn_meta() if session_id else {})})
                    if not interrupted and not content.interrupted:
                        for part in (content.model_turn.parts or []) if content.model_turn else []:
                            blob = part.inline_data
                            if not blob or not blob.data:
                                continue
                            format = pcm_format(blob.mime_type or "")
                            if not format or len(blob.data) % 2 or len(blob.data) > 384000:
                                raise CompanionError(502, "Gemini Live returned an unsupported audio format.")
                            if format != audio_format:
                                audio_format = format
                                await socket.send_json({"type": "audio_format", "rate": format[0], "channels": format[1]})
                            chunk_sequence += 1
                            if session_id:
                                await socket.send_json({"type": "audio_chunk", **turn_meta(), "sequence": chunk_sequence})
                            await socket.send_bytes(blob.data)
                            if claimed_event:
                                store.delivered(claimed_event, True)
                                claimed_event = None
                    if content.generation_complete and session_id:
                        await socket.send_json({"type": "generation_end", **turn_meta()})
                    if content.turn_complete and not idle.is_set():
                        await socket.send_json({"type": "turn_end", **turn_meta()} if session_id else {"type": "turn_end", "turn": turn})
                        turn += 1
                        changed = False
                        interrupted = False
                        narrative_id = None
                        habitat_calls = 0
                        speech_ids.clear()
                        if claimed_event:
                            store.delivered(claimed_event, False)
                            claimed_event = None
                        idle.set()
                if message.tool_call:
                    idle.clear()
                    await socket.send_json({"type": "state", "value": "responding", **turn_meta()})
                    responses = []
                    for call in (message.tool_call.function_calls or [])[:8]:
                        if call.id and call.id in speech_ids:
                            continue
                        if call.id:
                            speech_ids.add(call.id)
                        tool = TOOLS.get(call.name)
                        habitat = tool and tool.operation == "habitat"
                        if habitat:
                            habitat_calls += 1
                        if turn_event != store.read().event_id or (habitat and habitat_calls > 5):
                            result, action, change = {"error": "Turn expired or simulated action limit reached."}, None, None
                        else:
                            result, action, change = await asyncio.to_thread(
                                dispatch, call.name, call.args or {}, context, ui.model_dump(mode="json") if ui else None,
                                allow_writes=not changed, event_id=turn_event,
                            )
                        if action:
                            await socket.send_json({"type": "actions", **turn_meta(), "actions": [action.model_dump(mode="json")]})
                        if change:
                            changed = True
                            if change.refresh == "mission":
                                context = MissionPosition.model_validate(change.record)
                            await socket.send_json({"type": "change", **turn_meta(), "change": change.model_dump(mode="json")})
                        responses.append(types.FunctionResponse(name=call.name, id=call.id, response=jsonable_encoder(result)))
                    if responses:
                        async with provider_send:
                            await session.send_tool_response(function_responses=responses)
            if not received:
                raise ReconnectLive

    with store.subscribe() as queue:
        tasks = (asyncio.create_task(upload()), asyncio.create_task(download()),
                 asyncio.create_task(publish_situations(queue)))
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if claimed_event:
                store.delivered(claimed_event, False)


async def live(socket: WebSocket, scenario: Scenario, day: int = 30, ui: WorkspaceView | None = None,
               session_id: str | None = None):
    if not config.origin_allowed(socket.headers.get("origin"), socket.headers.get("host")):
        await socket.close(code=1008)
        return
    await socket.accept()
    try:
        models = await asyncio.to_thread(candidates, "live")
        async with client().aio as google:
            for index, model in enumerate(models):
                connected = False
                try:
                    async with google.live.connect(model=model, config=types.LiveConnectConfig(
                        response_modalities=["AUDIO"], system_instruction=SYSTEM, tools=declarations(),
                        input_audio_transcription=types.AudioTranscriptionConfig(),
                        output_audio_transcription=types.AudioTranscriptionConfig(),
                        context_window_compression=types.ContextWindowCompressionConfig(sliding_window=types.SlidingWindow()),
                    )) as session:
                        connected = True
                        await socket.send_json({"type": "state", "value": "listening"})
                        await bridge(socket, session, scenario, day, ui, model, session_id)
                        return
                except WebSocketDisconnect:
                    return
                except Exception as exc:
                    if connected or index == len(models) - 1 or provider_reason(exc) in ("auth", "quota"):
                        raise
    except WebSocketDisconnect:
        return
    except Exception as exc:
        reason = provider_reason(exc)
        retryable = isinstance(exc, ReconnectLive) or (not isinstance(exc, CompanionError) and reason in ("network", "timeout", "unavailable"))
        message = "The voice session closed. Reconnecting…" if isinstance(exc, ReconnectLive) else str(
            exc if isinstance(exc, CompanionError) else provider_error(exc))
        try:
            await socket.send_json({"type": "error", "message": message, "retryable": retryable})
            await socket.close(code=1012 if retryable else 1011)
        except (RuntimeError, WebSocketDisconnect):
            return

