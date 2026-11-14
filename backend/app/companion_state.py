from contextlib import closing
from datetime import datetime, timezone
from typing import Literal
from . import wellness
from .models import MissionDay, Scenario, StrictModel


class MissionPosition(StrictModel):
    scenario: Scenario
    day: MissionDay


class Change(StrictModel):
    operation: str
    record: dict
    refresh: Literal["mission", "wellness", "alerts"]


class Activity(StrictModel):
    id: int
    operation: str
    target: str
    date: str
    result: str
    undoable: bool
    entry_id: int | None = None


class StateError(Exception):
    pass


def store():
    db = wellness.connection()
    with db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS companion_activity (
                id INTEGER PRIMARY KEY, operation TEXT NOT NULL, target TEXT NOT NULL, date TEXT NOT NULL,
                result TEXT NOT NULL, scenario TEXT NOT NULL, day INTEGER NOT NULL, entry_id INTEGER,
                entry_version INTEGER, undone INTEGER NOT NULL DEFAULT 0
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS reviewed_alerts (
                scenario TEXT NOT NULL, day INTEGER NOT NULL, alert_id TEXT NOT NULL,
                PRIMARY KEY(scenario, day, alert_id)
            )
        """)
    return db


def audit(db, operation: str, target: str, context: MissionPosition, entry_id=None, version=None, result="applied"):
    db.execute("""
        INSERT INTO companion_activity (operation,target,date,result,scenario,day,entry_id,entry_version)
        VALUES (?,?,?,?,?,?,?,?)
    """, (operation, target, datetime.now(timezone.utc).isoformat(), result,
          context.scenario, context.day, entry_id, version))


def reviewed_alert_ids(context: MissionPosition) -> list[str]:
    with closing(store()) as db:
        return [row["alert_id"] for row in db.execute(
            "SELECT alert_id FROM reviewed_alerts WHERE scenario=? AND day=? ORDER BY alert_id",
            (context.scenario, context.day),
        )]


def reviewed_alert_history(scenario: Scenario, day: int) -> list[dict]:
    with closing(store()) as db:
        rows = db.execute(
            "SELECT day,alert_id FROM reviewed_alerts WHERE scenario=? AND day<=? ORDER BY day DESC LIMIT 30",
            (scenario, day),
        )
        return [dict(row) for row in rows]


def activity() -> list[Activity]:
    with closing(store()) as db:
        rows = db.execute("""
            SELECT a.*, c.version AS current_version
            FROM companion_activity a LEFT JOIN checkins c ON c.id=a.entry_id
            ORDER BY a.id DESC LIMIT 30
        """)
        return [Activity(id=row["id"], operation=row["operation"], target=row["target"],
                         date=row["date"], result=row["result"], entry_id=row["entry_id"],
                         undoable=row["operation"] in ("create_wellness_entry", "delete_wellness_entry") and not row["undone"]
                         and row["entry_version"] == row["current_version"])
                for row in rows]


def undo(activity_id: int) -> Change:
    with closing(store()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM companion_activity WHERE id=? AND undone=0", (activity_id,)).fetchone()
        if not row or row["operation"] not in ("create_wellness_entry", "delete_wellness_entry"):
            raise StateError("Este cambio no se puede deshacer.")
        context = MissionPosition(scenario=row["scenario"], day=row["day"])
        was_deleted = row["operation"] == "delete_wellness_entry"
        record = wellness.lookup(db, context.scenario, row["entry_id"], context.day, deleted=was_deleted)
        if not record or record["version"] != row["entry_version"]:
            raise StateError("El registro cambió después de la operación.")
        db.execute("UPDATE checkins SET deleted=?, version=version+1 WHERE id=?",
                   (int(not was_deleted), record["id"]))
        db.execute("UPDATE companion_activity SET undone=1 WHERE id=?", (activity_id,))
        audit(db, "undo", "wellness", context, record["id"])
        return Change(operation="undo", refresh="wellness", record={"id": record["id"], "deleted": not was_deleted})

