from typing import Annotated, Literal, Union

from pydantic import Field, TypeAdapter

from .models import Metric, Span, StrictModel

Section = Literal["overview", "vitals", "sleep", "wellness", "body"]
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


Action = Annotated[Union[Navigate, Chart, Viewer], Field(discriminator="type")]
ACTION = TypeAdapter(Action)

