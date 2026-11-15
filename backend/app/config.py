from os import environ
from pathlib import Path
from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]
ENV_FILE = BACKEND / ".env"
DEFAULT_TEXT_MODEL = "gemini-3.8-flash"
env = {**dotenv_values(ENV_FILE, interpolate=False, encoding="utf-8-sig"), **environ}
API_KEY = (env.get("GEMINI_API_KEY") or "").strip()
TEXT_MODEL = (env.get("GEMINI_MODEL") or "").strip() or DEFAULT_TEXT_MODEL
LIVE_MODEL = (env.get("GEMINI_LIVE_MODEL") or "").strip() or "auto"
EXTERNAL_ORIGIN = (env.get("RENDER_EXTERNAL_URL") or "").strip().rstrip("/")
PUBLIC_DEMO = bool(EXTERNAL_ORIGIN) or env.get("AEGIS_PUBLIC_DEMO") == "1"
ORBITAL_UI_ENABLED = (env.get("AEGIS_ORBITAL_UI_ENABLED") or "").strip().lower() in {"1", "true"}
FRONTEND_DIST = Path(env.get("AEGIS_FRONTEND_DIST") or BACKEND.parent / "frontend" / "dist")
LOCAL_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
ORIGINS = [
    origin.strip()
    for origin in (env.get("CORS_ORIGINS") or ("" if EXTERNAL_ORIGIN else ",".join(LOCAL_ORIGINS))).split(",")
    if origin.strip()
]


def origin_allowed(origin: str | None, host: str | None = None) -> bool:
    if not origin:
        return False
    if origin in ORIGINS or (EXTERNAL_ORIGIN and origin == EXTERNAL_ORIGIN):
        return True
    # Plain Docker preview and local FastAPI use their own loopback host and port.
    return not EXTERNAL_ORIGIN and bool(host and host.split(":")[0] in ("localhost", "127.0.0.1")
                                        and origin == f"http://{host}")
