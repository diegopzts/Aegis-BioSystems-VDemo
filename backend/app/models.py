from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Scenario(StrEnum):
    NOMINAL = "nominal"
    SHORT_SLEEP = "short_sleep"
    SHIFT = "schedule_shift"
    STRESS = "stress"
    RECOVERY = "recovery"


class Metric(StrEnum):
    HEART = "heartRate"
    TEMPERATURE = "temperature"
    OXYGEN = "spo2"
    SLEEP = "sleepHours"


class Span(StrEnum):
    DAY = "24h"
    WEEK = "7d"
    MONTH = "30d"


MissionDay = Annotated[int, Field(ge=1, le=30)]
EntryId = Annotated[int, Field(strict=True, gt=0, le=9223372036854775807)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]


Rating = Annotated[int, Field(strict=True, ge=1, le=5)]


class Checkin(StrictModel):
    mood: Rating
    stress: Rating | None = None
    energy: Rating | None = None
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)] = ""


class MoodEntry(Checkin):
    id: int | None = None
    day: int
    date: str
    recordedAt: datetime
    source: Literal["simulated", "checkin"]
    provenance: Literal["synthetic_simulation", "manual"] = "synthetic_simulation"


class ChatMessage(StrictModel):
    role: Literal["user", "assistant"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


Section = Literal["overview", "vitals", "sleep", "wellness", "body", "crew", "relax"]
CrewId = Literal["AST-01", "AST-02", "AST-03", "AST-04", "AST-05", "AST-06"]


class WorkspaceView(StrictModel):
    section: Section
    metric: Metric
    range: Span
    region: Literal["full", "head", "chest", "limbs"]
    view: Literal["front", "left", "right", "back"]
    crewId: CrewId | None = None


class ChatRequest(StrictModel):
    scenario: Scenario = Scenario.SHORT_SLEEP
    day: MissionDay = 30
    ui: WorkspaceView | None = None
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=13)]
