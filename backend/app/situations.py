import asyncio
from contextvars import ContextVar
from contextlib import contextmanager
from datetime import datetime, timezone
from enum import StrEnum
from threading import RLock
from time import time
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import Field, model_validator

from .models import StrictModel


class Situation(StrEnum):
    NOMINAL = "nominal"
    PANIC = "panic_bio_sync"
    LEAK = "o2_leak_zero_ui"
    ISOLATION = "extreme_isolation"
    MURPHY = "mars_murphy"


Sector = Literal["A", "B", "C"]
Reserve = Literal["off", "low", "high"]
Percent = Annotated[int, Field(strict=True, ge=0, le=100)]


class Habitat(StrictModel):
    oxygen_percent: float = 20.9
    co2_ppm: int = 600
    pressure_kpa: float = 101.3
    reserve_minutes_demo: int = 40
    sealed_sectors: list[Sector] = Field(default_factory=list)
    oxygen_reserve: Reserve = "off"
    lighting_percent: Percent = 65
    dust_storm: bool = False


NARRATIVES = {
    Situation.PANIC: "Anomalía detectada. Respire con calma. Inhala… exhala… Estoy aquí contigo; avisando a torre.",
    Situation.LEAK: "Anomalía detectada. Respire con calma. Inhala… exhala… Avisando a torre. Iniciando protocolo simulado.",
    Situation.ISOLATION: "Anomalía detectada. Respire con calma. Inhala… exhala… Estoy aquí para escucharte.",
    Situation.MURPHY: "Anomalía detectada. Respire con calma. Inhala… exhala… Avisando a torre. Estabilizando hábitat simulado.",
}


# Fixed demo geometry; changing a scenario does not advance the orbit.
EARTH_MARS_KM = 377_740_000
LIGHT_SPEED_KM_S = 299_792.458


class OrbitalTelemetry(StrictModel):
    distance_million_km: float
    one_way_seconds: int
    one_way_label: str
    link_status: Literal["normal", "warning"]
    link_label: str
    autonomous_override: bool
    synthetic: Literal[True] = True


def orbital_telemetry(scenario: Situation) -> OrbitalTelemetry:
    seconds = round(EARTH_MARS_KM / LIGHT_SPEED_KM_S)
    minutes, remainder = divmod(seconds, 60)
    nominal = scenario == Situation.NOMINAL
    return OrbitalTelemetry(
        distance_million_km=EARTH_MARS_KM / 1_000_000, one_way_seconds=seconds,
        one_way_label=f"{minutes} min {remainder:02d} s",
        link_status="normal" if nominal else "warning",
        link_label="Enlace nominal" if nominal else "SIN RESPUESTA EN TIEMPO REAL",
        autonomous_override=not nominal,
    )


class Snapshot(StrictModel):
    scenario_id: Situation
    scenario_name: str
    orbital: OrbitalTelemetry
    active_mode: Literal["standard", "breathing_sync", "zero_ui", "ground_anchor"]
    started_at: datetime
    mission_day: int | None = None
    heart_rate_bpm: int | None = None
    stress_proxy: int | None = None
    emotional_fatigue_demo: bool = False
    communication_delay_minutes: int | None = None
    breathing_guide: bool = False
    ambience: Literal["silent", "soft_wind", "warm_rain", "dust_wind"] = "silent"
    habitat: Habitat
    actions: list[str] = Field(default_factory=list)
    event_id: str
    version: int = 0
    pending_live: bool = False
    narrative: str | None = None


class SectorInput(StrictModel):
    sector_id: Sector


class ReserveInput(StrictModel):
    level: Reserve


class LightingInput(StrictModel):
    percent: Percent


class StabilizeInput(StrictModel):
    actions: Annotated[list[Literal["seal_b", "reserve_high", "dim_lights"]], Field(min_length=1, max_length=3)]

    @model_validator(mode="after")
    def no_duplicates(self):
        if len(set(self.actions)) != len(self.actions):
            raise ValueError("Duplicate actions")
        return self


class Activation(StrictModel):
    event_id: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")] = Field(default_factory=lambda: uuid4().hex)


def build_snapshot(scenario: Situation, event_id: str, version: int) -> Snapshot:
    variants = {
        Situation.NOMINAL: ("Nominal", "standard", {}),
        Situation.PANIC: ("Crisis de Pánico · Bio-Sync 6 RPM", "breathing_sync",
                          {"heart_rate_bpm": 148, "stress_proxy": 89, "breathing_guide": True, "ambience": "soft_wind"}),
        Situation.LEAK: ("Fuga de O₂ · Zero-UI Supervivencia", "zero_ui",
                         {"ambience": "soft_wind", "habitat": Habitat(oxygen_percent=16.4, co2_ppm=1850, pressure_kpa=84.5, reserve_minutes_demo=18)}),
        Situation.ISOLATION: ("Aislamiento Extremo · Ancla de Tierra", "ground_anchor",
                              {"mission_day": 142, "communication_delay_minutes": orbital_telemetry(scenario).one_way_seconds // 60, "emotional_fatigue_demo": True, "ambience": "warm_rain"}),
        Situation.MURPHY: ("Mars Murphy’s Law · Crisis Total", "zero_ui",
                          {"heart_rate_bpm": 162, "breathing_guide": True, "ambience": "dust_wind",
                           "habitat": Habitat(oxygen_percent=15.8, co2_ppm=2100, pressure_kpa=82, reserve_minutes_demo=12, dust_storm=True)}),
    }
    name, mode, values = variants[scenario]
    return Snapshot(scenario_id=scenario, scenario_name=name, active_mode=mode, orbital=orbital_telemetry(scenario),
                    started_at=datetime.now(timezone.utc), event_id=event_id, version=version,
                    pending_live=scenario != Situation.NOMINAL, narrative=NARRATIVES.get(scenario),
                    **{"habitat": Habitat(), **values})


class SituationStore:
    def __init__(self):
        self._lock = RLock()
        self._value = build_snapshot(Situation.NOMINAL, uuid4().hex, int(time() * 1000))
        self._seen = {}
        self._listeners = {}
        self._claim = None

    def read(self) -> Snapshot:
        with self._lock:
            return self._value

    def _publish(self, value):
        self._value = value
        for queue, loop in self._listeners.items():
            loop.call_soon_threadsafe(self._offer, queue, value)
        return value

    @staticmethod
    def _offer(queue, value):
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(value)

    @contextmanager
    def subscribe(self):
        queue = asyncio.Queue(maxsize=1)
        with self._lock:
            self._listeners[queue] = asyncio.get_running_loop()
            queue.put_nowait(self._value)
        try:
            yield queue
        finally:
            with self._lock:
                self._listeners.pop(queue, None)

    def activate(self, scenario, event_id):
        with self._lock:
            if event_id == self._value.event_id:
                if self._value.scenario_id != scenario:
                    raise ValueError("El identificador ya pertenece a otra situación.")
                return self._value
            if event_id in self._seen:
                if self._seen[event_id] != scenario:
                    raise ValueError("El identificador ya pertenece a otra situación.")
                return self._value
            self._seen[event_id] = scenario
            if len(self._seen) > 256:
                self._seen.pop(next(iter(self._seen)))
            self._claim = None
            return self._publish(build_snapshot(scenario, event_id, self._value.version + 1))

    def claim(self, event_id):
        with self._lock:
            if self._value.event_id != event_id or not self._value.pending_live or self._claim is not None:
                return False
            self._claim = event_id
            return True

    def delivered(self, event_id, success):
        with self._lock:
            if self._claim != event_id:
                return
            self._claim = None
            if success and self._value.event_id == event_id:
                self._publish(self._value.model_copy(update={"pending_live": False, "version": self._value.version + 1}))

    def mutate(self, name, args, event_id):
        with self._lock:
            current = self._value
            if event_id != current.event_id or current.scenario_id == Situation.NOMINAL:
                raise ValueError("La situación terminó o cambió.")
            habitat = current.habitat.model_dump()
            operations = {
                "seal_habitat_sector": [(name, args.get("sector_id"))],
                "activate_oxygen_reserve": [(name, args.get("level"))],
                "set_cabin_lighting": [(name, args.get("percent"))],
            }
            prescribed = {
                "seal_b": ("seal_habitat_sector", "B"),
                "reserve_high": ("activate_oxygen_reserve", "high"),
                "dim_lights": ("set_cabin_lighting", 15),
            }
            steps = [prescribed[item] for item in args["actions"]] if name == "stabilize_simulated_environment" else operations[name]
            changes = []
            for action, value in steps:
                if action == "seal_habitat_sector":
                    if value in habitat["sealed_sectors"]:
                        continue
                    habitat["sealed_sectors"].append(value)
                else:
                    key = "oxygen_reserve" if action == "activate_oxygen_reserve" else "lighting_percent"
                    if habitat[key] == value:
                        continue
                    habitat[key] = value
                changes.append(f"{action}: {value}")
            if not changes:
                return current
            return self._publish(current.model_copy(update={
                "habitat": Habitat.model_validate(habitat), "version": current.version + 1,
                "actions": (current.actions + changes)[-24:],
            }))


situations = SituationStore()
visitor_situations: ContextVar[SituationStore | None] = ContextVar("visitor_situations", default=None)


def active_situations(default: SituationStore) -> SituationStore:
    return visitor_situations.get() or default


def prompt(snapshot: Snapshot) -> str:
    framing = {
        Situation.PANIC: "Acompaña con calidez. Invita opcionalmente al pulso visual de 6 ciclos/min, respiración cómoda sin retener el aire.",
        Situation.LEAK: "Como director de vuelo simulado, usa frases de hasta 8 palabras. Ejecuta sellado B, reserva high y luz 15%, paso a paso.",
        Situation.ISOLATION: "Pregunta cómo se siente la persona, escucha y ofrece opciones. No asumas aislamiento real ni infieras emociones.",
        Situation.MURPHY: "Primero di una frase breve y cálida. Después ejecuta estabilización sintética de Sector B, reserva high y luz 15%.",
    }
    return ("Evento interno de simulación AEGIS. Inicia ahora una respuesta hablada sin esperar voz. "
            "Abre con la narrativa exacta entre comillas, sin anunciar el botón ni decir nada antes. Usa voz cálida y pausada. Después, si mencionaste torre, aclara que es solo la torre simulada y que no se notificó a nadie. Sin diagnóstico ni hardware real. "
            f"«{snapshot.narrative}» Escenario simulado; pulso={snapshot.heart_rate_bpm} bpm; O₂={snapshot.habitat.oxygen_percent}%; "
            f"día narrativo={snapshot.mission_day}; retardo ficticio={snapshot.communication_delay_minutes} min. "
            f"{framing[snapshot.scenario_id]}")



def apply_current_pulse(series: dict, metric, span, snapshot: Snapshot) -> dict:
    if metric != "heartRate" or snapshot.heart_rate_bpm is None:
        return series
    points = series["points"]
    if span == "24h":
        baseline = sum(point["value"] for point in points) / len(points)
        for point in points:
            point["value"] = round(point["value"] - baseline + snapshot.heart_rate_bpm, 2)
    else:
        points[-1]["value"] = snapshot.heart_rate_bpm
    return series
