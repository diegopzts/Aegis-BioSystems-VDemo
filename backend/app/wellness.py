import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from statistics import correlation, StatisticsError

from .config import BACKEND
from .models import Checkin, MoodEntry, Scenario
from .simulation import dataset
from .visitors import visitor_db

DB_PATH = BACKEND / "data" / "wellness.sqlite3"


def connection():
    path = visitor_db.get() or DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""
                CREATE TABLE IF NOT EXISTS checkins (
                    id INTEGER PRIMARY KEY, scenario TEXT NOT NULL,
                    mood INTEGER NOT NULL, stress INTEGER NOT NULL, energy INTEGER NOT NULL,
                    notes TEXT NOT NULL, recorded_at TEXT NOT NULL,
                    mission_day INTEGER NOT NULL DEFAULT 30, deleted INTEGER NOT NULL DEFAULT 0,
                    version INTEGER NOT NULL DEFAULT 0
                )
            """)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(checkins)")}
            for name, default in (("mission_day", 30), ("deleted", 0), ("version", 0)):
                if name not in columns:
                    db.execute(f"ALTER TABLE checkins ADD COLUMN {name} INTEGER NOT NULL DEFAULT {default}")
    except Exception:
        db.close()
        raise
    return db


def entry(row, scenario: Scenario, include_notes: bool = False) -> MoodEntry:
    return MoodEntry(
        id=row["id"], day=row["mission_day"], date=dataset(scenario)[row["mission_day"] - 1]["date"],
        mood=row["mood"], stress=row["stress"] or None, energy=row["energy"] or None,
        notes=row["notes"] if include_notes else "", recordedAt=row["recorded_at"],
        source="checkin", provenance="manual",
    )


def lookup(db, scenario: Scenario, entry_id: int, day: int, *, deleted: bool = False):
    return db.execute(
        "SELECT * FROM checkins WHERE id=? AND scenario=? AND mission_day<=? AND deleted=?",
        (entry_id, scenario, day, int(deleted)),
    ).fetchone()


def insert(db, scenario: Scenario, rating: Checkin, day: int) -> MoodEntry:
    now = datetime.now(timezone.utc).isoformat()
    result = db.execute(
        "INSERT INTO checkins (scenario,mood,stress,energy,notes,recorded_at,mission_day) VALUES (?,?,?,?,?,?,?)",
        (scenario, rating.mood, rating.stress or 0, rating.energy or 0, rating.notes, now, day),
    )
    return entry(lookup(db, scenario, result.lastrowid, day), scenario, True)


def record(scenario: Scenario, rating: Checkin, day: int = 30) -> MoodEntry:
    with closing(connection()) as db, db:
        return insert(db, scenario, rating, day)


def manual_entries(scenario: Scenario, day: int, limit: int, include_notes: bool, before_id: int | None = None):
    columns = "id, mission_day, mood, stress, energy, recorded_at" + (", notes" if include_notes else "")
    with closing(connection()) as db:
        rows = db.execute(
            f"SELECT {columns} FROM checkins WHERE scenario=? AND mission_day<=? AND deleted=0 AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT ?",
            (scenario, day, before_id, before_id, limit),
        )
        return [entry(row, scenario, include_notes) for row in rows]


def summary(scenario: Scenario, include_notes: bool = True, day: int = 30) -> dict:
    days = dataset(scenario)[:day]
    simulated = [
        MoodEntry(day=row["day"], date=row["date"], mood=row["mood"], stress=row["stress"],
                  energy=row["energy"], recordedAt=f'{row["date"]}T12:00:00Z', source="simulated")
        for row in days
    ]
    entries = manual_entries(scenario, day, 50, include_notes)
    by_day = {item.day: item for item in reversed(entries)}
    timeline = [by_day.get(item.day, item) for item in simulated]
    trend = [
        {"day": item.day, "date": item.date, "mood": item.mood, "energy": item.energy,
         "stress": item.stress, "sleepHours": row["sleepHours"], "provenance": item.provenance}
        for item, row in zip(timeline, days)
    ]
    recent = [row for row in trend[-14:] if row["stress"] is not None]
    try:
        r = round(correlation([row["sleepHours"] for row in recent], [row["stress"] for row in recent]), 2)
    except StatisticsError:
        r = None
    return {"history": entries + [item for item in reversed(simulated) if item.day not in by_day],
            "trend": trend, "current": timeline[-1], "stressSleepCorrelation": r, "pairedDays": len(recent)}
