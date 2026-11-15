from collections import deque
from contextvars import ContextVar
from threading import Lock
from time import monotonic
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from .models import StrictModel

Mode = Literal["simulation", "paused", "usb", "closed"]


class SyntheticSample(StrictModel):
    profile: Literal["normal", "stemi", "fv", "paro", "custom"]
    ecgBpm: Annotated[int, Field(ge=0, le=245)]
    spo2: Annotated[int, Field(ge=60, le=100)]
    sto2: Annotated[int, Field(ge=30, le=100)]
    rso2: Annotated[int, Field(ge=25, le=95)]
    radiationProfile: Literal["saludable", "ligero", "preocupante", "peligro"]
    h2o2: Annotated[float, Field(ge=0, le=25)]
    o2: Annotated[float, Field(ge=0, le=4)]
    onoo: Annotated[int, Field(ge=0, le=160)]
    no: Annotated[int, Field(ge=0, le=100)]
    gsh: Annotated[float, Field(ge=0, le=5)]
    mda: Annotated[float, Field(ge=0, le=6)]

    @model_validator(mode="after")
    def ecg_profile_matches(self):
        rates = {"normal": 77, "stemi": 98, "fv": 245, "paro": 0}
        if (self.profile == "custom" and not 30 <= self.ecgBpm <= 220
                or self.profile != "custom" and self.ecgBpm != rates[self.profile]):
            raise ValueError("La frecuencia no coincide con el perfil sintético.")
        return self


class MonitorUpdate(StrictModel):
    tab: UUID
    epoch: Annotated[int, Field(strict=True, ge=0, le=1_000_000)]
    mode: Mode
    sample: SyntheticSample | None = None

    @model_validator(mode="after")
    def synthetic_only(self):
        if (self.mode == "simulation") != (self.sample is not None):
            raise ValueError("Solo se aceptan mediciones en modo sintético.")
        return self


class MonitorStore:
    """Short-lived visitor-local snapshots. Raw waveforms and USB samples are never accepted."""
    def __init__(self, clock=monotonic):
        self.clock = clock
        self.lock = Lock()
        self.tabs = {}

    def set(self, frame: MonitorUpdate):
        with self.lock:
            now = self.clock()
            previous = self.tabs.get(frame.tab)
            if previous and (frame.epoch < previous[1].epoch or previous[1].mode == "closed"):
                return
            history = (previous[2] if previous and frame.epoch == previous[1].epoch
                       and frame.mode not in ("usb", "closed") and now - previous[0] <= 12 else deque(maxlen=61))
            if frame.sample:
                row = (now, frame.sample)
                if history and int(history[-1][0]) == int(now):
                    history[-1] = row
                else:
                    history.append(row)
            self.tabs[frame.tab] = now, frame, history
            if len(self.tabs) > 4:
                oldest = min(self.tabs, key=lambda tab: self.tabs[tab][0])
                del self.tabs[oldest]

    def read(self):
        with self.lock:
            now = self.clock()
            active = [row for row in self.tabs.values() if row[1].mode != "closed" and now - row[0] <= 12]
            if not active:
                return {"status": "unavailable", "reason": "monitor_closed_or_stale"}
            stamp, frame, history = max(active, key=lambda item: item[0])
            if not frame.sample:
                return {"status": "unavailable", "reason": frame.mode}
            recent = [(time, row.ecgBpm) for time, row in history if now - time <= 60 and row.profile != "fv"]
            return {
                "status": "live_simulation", "ageSeconds": round(now - stamp, 1),
                "sample": frame.sample.model_dump(),
                "units": {"ecgBpm": "lpm (perfil ECG)", "spo2": "%", "sto2": "%", "rso2": "%",
                          "h2o2": "µM", "o2": "nM", "onoo": "nM", "no": "nM", "gsh": "mM", "mda": "µM"},
                "lastMinute": {"sampleCount": len(recent),
                               "coverageSeconds": round(recent[-1][0] - recent[0][0], 1) if recent else 0,
                               "minEcgBpm": min((value for _, value in recent), default=None),
                               "maxEcgBpm": max((value for _, value in recent), default=None),
                               "changeEcgBpm": recent[-1][1] - recent[0][1] if len(recent) > 1 else None},
            }


visitor_monitor: ContextVar[MonitorStore | None] = ContextVar("visitor_monitor", default=None)
local_monitor = MonitorStore()


def monitor():
    return visitor_monitor.get() or local_monitor
