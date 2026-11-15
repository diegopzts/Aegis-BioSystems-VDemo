from typing import Annotated, Literal, Union

from pydantic import Field, TypeAdapter

from .models import CrewId, Metric, Section, Span, StrictModel

Region = Literal["full", "head", "chest", "limbs"]


class Navigate(StrictModel):
    type: Literal["navigate"]
    section: Section


class Chart(StrictModel):
    type: Literal["chart"]
    metric: Metric
    range: Span


class Viewer(StrictModel):
    type: Literal["viewer"]
    region: Region
    view: Literal["front", "left", "right", "back"]


class Relax(StrictModel):
    type: Literal["relax"]
    command: Literal["start_breathing", "play_ambient", "pause_ambient", "stop_ambient", "open_memory", "open_zen"]


class SelectCrew(StrictModel):
    type: Literal["crew"]
    crewId: CrewId


class Orbit(StrictModel):
    type: Literal["orbit"]


Action = Annotated[Union[Navigate, Chart, Viewer, Relax, SelectCrew, Orbit], Field(discriminator="type")]
ACTION = TypeAdapter(Action)

