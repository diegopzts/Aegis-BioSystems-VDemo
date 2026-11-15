import re
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from secrets import token_urlsafe
from tempfile import TemporaryDirectory
from time import monotonic

from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from . import config
from .live_vitals import MonitorStore, visitor_monitor
from .situations import SituationStore, visitor_situations

ID = re.compile(r"[A-Za-z0-9_-]{43}")
IDLE_TTL = 60 * 60
MAX_VISITORS = 256
visitor_db: ContextVar[Path | None] = ContextVar("visitor_db", default=None)
visitor_id: ContextVar[str | None] = ContextVar("visitor_id", default=None)


@dataclass
class Visitor:
    directory: TemporaryDirectory = field(default_factory=lambda: TemporaryDirectory(prefix="aegis-"))
    situations: SituationStore = field(default_factory=SituationStore)
    monitor: MonitorStore = field(default_factory=MonitorStore)
    seen: float = field(default_factory=monotonic)
    active: int = 0


class VisitorMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app
        self.visitors: dict[str, Visitor] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        kind = scope["type"]
        if not config.PUBLIC_DEMO or kind not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        headers = Headers(scope=scope)
        api = path.startswith("/api/")
        page = kind == "http" and scope["method"] in ("GET", "HEAD") and (
            path == "/" or "text/html" in headers.get("accept", ""))
        if path in {"/api/health", "/api/config"} or not (api or page) or scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return
        secure = config.EXTERNAL_ORIGIN.startswith("https://") or scope["scheme"] in ("https", "wss")
        cookie = "__Host-aegis_visit" if secure else "aegis_visit"
        identity = HTTPConnection(scope).cookies.get(cookie, "")
        fresh = not ID.fullmatch(identity)
        if kind == "websocket" and (fresh or not config.origin_allowed(headers.get("origin"), headers.get("host"))):
            await send({"type": "websocket.close", "code": 1008})
            return
        if fresh:
            identity = token_urlsafe(32)
        now = monotonic()
        for key, visitor in list(self.visitors.items()):
            if not visitor.active and now - visitor.seen >= IDLE_TTL:
                self.visitors.pop(key).directory.cleanup()
        if identity not in self.visitors:
            if len(self.visitors) >= MAX_VISITORS:
                if kind == "websocket":
                    await send({"type": "websocket.close", "code": 1013})
                else:
                    await JSONResponse({"detail": "La demo está ocupada. Intenta más tarde."}, 503)(scope, receive, send)
                return
            self.visitors[identity] = Visitor()

        visitor = self.visitors[identity]
        visitor.active += 1
        db_token = visitor_db.set(Path(visitor.directory.name) / "wellness.sqlite3")
        store_token = visitor_situations.set(visitor.situations)
        id_token = visitor_id.set(identity)
        monitor_token = visitor_monitor.set(visitor.monitor)

        async def send_private(message):
            if message["type"] == "http.response.start":
                response = MutableHeaders(scope=message)
                response["Cache-Control"] = "private, no-store"
                if fresh:
                    value = f"{cookie}={identity}; Path=/; HttpOnly; SameSite=Lax"
                    response.append("Set-Cookie", value + ("; Secure" if secure else ""))
            await send(message)

        try:
            await self.app(scope, receive, send_private)
        finally:
            visitor_monitor.reset(monitor_token)
            visitor_id.reset(id_token)
            visitor_situations.reset(store_token)
            visitor_db.reset(db_token)
            visitor.active -= 1
            visitor.seen = monotonic()
