from contextlib import closing
from dataclasses import dataclass
from statistics import mean
from sqlite3 import Error as DatabaseError
from typing import Annotated, Literal

from google.genai import types
from pydantic import Field, ValidationError, model_validator

from . import analytics, mission, simulation, wellness
from .companion_state import Change, MissionPosition, StateError, activity, audit, reviewed_alert_history, reviewed_alert_ids, store, undo
from .situations import LightingInput, ReserveInput, SectorInput, StabilizeInput, active_situations, apply_current_pulse, situations
from .interface_actions import ACTION, Action
from .live_vitals import monitor
from .crew import crew_status
from .models import Checkin, EntryId, Metric, MissionDay, Notes, Rating, Scenario, Span, StrictModel

Period = Literal["7d", "14d", "30d"]
Source = Literal["synthetic_simulation", "manual", "mixed"]


class ReadResult(StrictModel):
    source: str
    provenance: Source
    data: dict | list


class PeriodArgs(StrictModel):
    period: Period


class SleepArgs(PeriodArgs):
    days: Annotated[list[MissionDay], Field(max_length=10)] = []


class VitalArgs(StrictModel):
    metric: Metric
    range: Span
    day: MissionDay | None = None


class EntryArgs(StrictModel):
    id: EntryId


class EntriesArgs(StrictModel):
    limit: Annotated[int, Field(strict=True, ge=1, le=10)]
    include_notes: bool = True
    before_id: EntryId | None = None
    scenario: Scenario | None = None


class UpdateArgs(EntryArgs):
    mood: Rating | None = None
    stress: Rating | None = None
    energy: Rating | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def require_change(self):
        if all(value is None for value in (self.mood, self.stress, self.energy, self.notes)):
            raise ValueError("At least one change is required")
        return self


class ScenarioArgs(StrictModel):
    scenario: Scenario


class AlertArgs(StrictModel):
    id: Literal["sleep-1", "sleep-2", "sleep-3", "vital-heartRate", "vital-temperature", "vital-spo2"]


class UiArgs(StrictModel):
    action: Action


@dataclass(frozen=True)
class Tool:
    description: str
    model: type[StrictModel]
    operation: str = "read"


TOOLS = {
    "get_crew_status": Tool(
        "Read the six synthetic crew profiles and duty status. The result includes the selected crew member "
        "and their sleep history. Use this for who is resting, pending check-ins, and crew summaries. "
        "Operational status is separate from wellness.", StrictModel,
    ),
    "get_live_vitals": Tool(
        "Read the live synthetic ECG and oxygen readings and the available last-minute trend, separate from "
        "mission history. Data is unavailable when the monitor is closed, paused, or using local USB. "
        "Report actual coverage. Do not call ECG rate an arterial pulse, diagnose, or recommend treatment.", StrictModel,
    ),
    "get_simulation_state": Tool("Read the active simulation's state, synthetic biometrics and habitat actions.", StrictModel),
    "seal_habitat_sector": Tool("Seal a sector of the simulated habitat only.", SectorInput, "habitat"),
    "activate_oxygen_reserve": Tool("Set the simulated oxygen reserve.", ReserveInput, "habitat"),
    "set_cabin_lighting": Tool("Set the simulated lighting level.", LightingInput, "habitat"),
    "stabilize_simulated_environment": Tool("Apply up to three allowed actions to the simulated habitat.", StabilizeInput, "habitat"),
    "get_mission_overview": Tool("Read synthetic mission status and progress, excluding health data.", StrictModel),
    "get_vitals_summary": Tool("Read a synthetic vital sign and trend for 24 hours, 7 days, or 30 days.", VitalArgs),
    "get_sleep_records": Tool("Read sleep details for a period or up to ten individual days.", SleepArgs),
    "analyze_sleep": Tool("Read sleep criteria, evidence, and recommendations through the current day.", StrictModel),
    "get_wellness_summary": Tool("Read average mood, energy, and stress by period and source without notes.", PeriodArgs),
    "get_wellness_entries": Tool("Read up to ten manual check-ins. Include notes only when relevant. Paginate with before_id.", EntriesArgs),
    "get_alerts": Tool("Read recorded alerts, evidence, severity, and review status.", StrictModel),
    "get_full_mission_context": Tool("Read a short summary across mission modules without private notes.", StrictModel),
    "create_wellness_entry": Tool("Create a check-in only on explicit request to save it with the three values provided. Include notes only on explicit request.", Checkin, "write"),
    "update_wellness_entry": Tool("Edit requested fields of a manual record by ID.", UpdateArgs, "write"),
    "delete_wellness_entry": Tool("Reversibly remove a manual record by ID.", EntryArgs, "write"),
    "acknowledge_alert": Tool("Mark a supported alert for the current day as reviewed.", AlertArgs, "write"),
    "set_mission_scenario": Tool("Select an allowed scenario and preserve the current day.", ScenarioArgs, "write"),
    "advance_mission": Tool("Advance exactly one day, up to day 30.", StrictModel, "write"),
    "reset_mission": Tool("Return to day 1 of the default scenario. Keep records and reviewed alerts.", StrictModel, "write"),
    "get_simulator_state": Tool("Read simulation scenarios, mission position, date limits, and UI state.", StrictModel),
    "get_activity": Tool("Read the latest 30 stored changes and which can be undone.", StrictModel),
    "undo_change": Tool("Undo a reversible change by activity ID.", EntryArgs, "write"),
    "control_ui": Tool(
        "Apply a supported interface action on explicit request. Navigate with crew for Crew Management or "
        "relax for Relax Room. Use the crew action to select a known crewId. Use relax for start_breathing, "
        "play_ambient, pause_ambient, stop_ambient, open_memory or open_zen. Use orbit to return to the orbital view. "
        "Use chart to select a vital sign. "
        "BioSystems 3D supports full body, head, chest and limbs from the front, left, right or back. "
        "Reset with full and front. The model shows musculoskeletal anatomy. Do not offer organ or cardiovascular views.",
        UiArgs, "ui",
    ),
}

def declarations():
    return [types.Tool(function_declarations=[
        types.FunctionDeclaration(name=name, description=tool.description,
                                  parameters_json_schema=tool.model.model_json_schema())
        for name, tool in TOOLS.items()
    ])]


def vitals_snapshot(context):
    return {
        metric.value: {
            "value": series["points"][-1]["value"], "baseline": series["baseline"],
            "unit": series["unit"],
            "delta": round(series["points"][-1]["value"] - mean(point["value"] for point in series["points"]), 2),
        }
        for metric in (Metric.HEART, Metric.TEMPERATURE, Metric.OXYGEN)
        for series in (apply_current_pulse(simulation.vitals(context.scenario, metric, Span.WEEK, context.day),
                                           metric, Span.WEEK, active_situations(situations).read()),)
    }


def alerts(context):
    scenario, day = context.scenario, context.day
    results = []
    for index, item in enumerate(analytics.sleep_analysis(scenario, day=day)["recommendations"], 1):
        if item["level"] != "favorable":
            results.append({"id": f"sleep-{index}", "severity": item["level"],
                            "evidence": item["reason"], "days": item["days"]})
    limits = {"heartRate": 8, "temperature": 0.5, "spo2": 2}
    for metric, item in vitals_snapshot(context).items():
        if abs(item["value"] - item["baseline"]) > limits[metric]:
            results.append({"id": f"vital-{metric}", "severity": "watch", "evidence": item, "days": [day]})
    reviewed = set(reviewed_alert_ids(context))
    return [{**item, "reviewed": item["id"] in reviewed} for item in results]


def wellbeing(context, period: Period):
    scenario, day = context.scenario, context.day
    start = max(1, day - int(period[:-1]) + 1)
    manual = [row for row in wellness.manual_entries(scenario, day, 50, False) if row.day >= start]
    simulated = simulation.dataset(scenario)[start - 1:day]
    metrics = ("mood", "stress", "energy")
    valid = {key: [value for row in manual if (value := getattr(row, key)) is not None] for key in metrics}
    return {"period": period, "fromDay": start, "throughDay": day,
            "manual": {"count": len(manual), "sampleLimit": 50, "averages": {
                key: round(mean(valid[key]), 2) if valid[key] else None for key in metrics}},
            "synthetic_simulation": {"count": len(simulated), "averages": {
                key: round(mean(row[key] for row in simulated), 2) for key in metrics}}}


def read(name, args, context, ui) -> ReadResult:
    scenario, day = context.scenario, context.day
    provenance: Source = "synthetic_simulation"
    if name == "get_crew_status":
        data = crew_status(scenario, day)
        data["selectedCrewId"] = (ui or {}).get("crewId") or "AST-01"
    elif name == "get_live_vitals":
        data = monitor().read()
    elif name == "get_mission_overview":
        position = simulation.dataset(scenario)[day - 1]
        data = {"mission": mission.MISSION_NAME, "scenario": scenario, "day": day,
                "date": position["date"], "daysAvailable": simulation.DAYS, "plannedDays": 210}
    elif name == "get_vitals_summary":
        if args.day and args.day > day:
            raise StateError("That day is not yet available.")
        data = simulation.vitals(scenario, args.metric, args.range, args.day or day)
        if (args.day or day) == day:
            apply_current_pulse(data, args.metric, args.range, active_situations(situations).read())
        values = [point["value"] for point in data["points"]]
        data.update(average=round(mean(values), 2), change=round(values[-1] - values[0], 2))
    elif name == "get_sleep_records":
        rows = analytics.calendar(scenario, day=day)
        if any(item > day for item in args.days):
            raise StateError("A requested day is not yet available.")
        data = [row for row in rows if row["day"] in args.days] if args.days else rows[-int(args.period[:-1]):]
    elif name == "analyze_sleep":
        data = analytics.sleep_analysis(scenario, day=day)
    elif name == "get_wellness_summary":
        data, provenance = wellbeing(context, args.period), "mixed"
    elif name == "get_wellness_entries":
        data = [row.model_dump(mode="json", exclude=set() if args.include_notes else {"notes"})
                for row in wellness.manual_entries(args.scenario or scenario, day, args.limit,
                                                   args.include_notes, args.before_id)]
        provenance = "manual"
    elif name == "get_alerts":
        data = {"current": alerts(context), "reviewHistory": reviewed_alert_history(scenario, day)}
    elif name == "get_simulator_state":
        data = {"position": context.model_dump(mode="json"), "scenarios": list(Scenario),
                "firstDay": 1, "lastDay": simulation.DAYS, "ui": ui}
    elif name == "get_activity":
        data = [item.model_dump() for item in activity()]
        provenance = "manual"
    else:
        sections = {
            section: read(section, PeriodArgs(period="7d"), context, ui).model_dump()
            for section in ("get_mission_overview", "analyze_sleep", "get_wellness_summary", "get_alerts")
        }
        sections["get_vitals_summary"] = {"source": "synthetic_simulation", "data": vitals_snapshot(context)}
        data, provenance = sections, "mixed"
    return ReadResult(source=name, provenance=provenance, data=data)


def apply_change(name, args, context) -> Change:
    scenario, day = context.scenario, context.day
    fields = args.model_dump(exclude_none=True, mode="json", exclude_unset=True)
    if name == "undo_change":
        return undo(args.id)
    if name == "acknowledge_alert" and not any(item["id"] == args.id for item in alerts(context)):
        raise StateError("No matching alert exists for the current day.")
    if name == "advance_mission" and day == simulation.DAYS:
        raise StateError("This is the final simulated day. Reset to return to day 1.")
    with closing(store()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        if name.endswith("_wellness_entry"):
            if name == "create_wellness_entry":
                entry = wellness.insert(db, scenario, args, day)
                version = 0
            else:
                previous = wellness.lookup(db, scenario, args.id, day)
                if not previous:
                    raise StateError("The manual record is unavailable in this view.")
                version = previous["version"] + 1
                deleted = name == "delete_wellness_entry"
                if deleted:
                    db.execute("UPDATE checkins SET deleted=1, version=? WHERE id=?", (version, args.id))
                else:
                    values = dict(previous)
                    values.update(fields)
                    db.execute("UPDATE checkins SET mood=?,stress=?,energy=?,notes=?,version=? WHERE id=?",
                               (values["mood"], values["stress"], values["energy"], values["notes"], version, args.id))
                entry = wellness.entry(wellness.lookup(db, scenario, args.id, day, deleted=deleted), scenario, True)
            audit(db, name, "wellness", context, entry.id, version)
            record = entry.model_dump(mode="json")
            if name == "delete_wellness_entry":
                record = {"id": entry.id, "deleted": True}
            return Change(operation=name, record=record, refresh="wellness")
        if name == "acknowledge_alert":
            db.execute("INSERT OR IGNORE INTO reviewed_alerts VALUES (?,?,?)", (scenario, day, args.id))
            audit(db, name, args.id, context)
            return Change(operation=name, record={"id": args.id, "reviewed": True}, refresh="alerts")
        if name == "set_mission_scenario":
            position = MissionPosition(scenario=args.scenario, day=day)
        elif name == "advance_mission":
            position = MissionPosition(scenario=scenario, day=day + 1)
        else:
            position = MissionPosition(scenario=Scenario.NOMINAL, day=1)
        audit(db, name, "mission", position)
        return Change(operation=name, record=position.model_dump(mode="json"), refresh="mission")

def dispatch(name, args, context, ui=None, *, allow_writes=True, event_id=None):
    tool = TOOLS.get(name)
    if not tool:
        return {"error": "Unknown tool."}, None, None
    try:
        values = tool.model.model_validate(args)
        if name == "get_simulation_state":
            return {"result": {"source": name, "data": active_situations(situations).read().model_dump(mode="json")}}, None, None
        if tool.operation == "habitat":
            try:
                state = active_situations(situations).mutate(name, values.model_dump(), event_id or "")
            except ValueError as exc:
                return {"error": str(exc)}, None, None
            return {"result": state.model_dump(mode="json")}, None, None
        if tool.operation == "ui":
            return {"result": "Interface action accepted"}, ACTION.validate_python(values.action), None
        if tool.operation == "write":
            if not allow_writes:
                raise StateError("One change has already been applied. Request the next change in a new turn.")
            change = apply_change(name, values, context)
            return {"result": change.model_dump(mode="json")}, None, change
        result = read(name, values, context, ui)
        return {"result": result.model_dump(mode="json")}, None, None
    except ValidationError:
        return {"error": "Invalid arguments."}, None, None
    except DatabaseError:
        return {"error": "Could not complete the local operation."}, None, None
    except StateError as exc:
        return {"error": str(exc)}, None, None
