from .analytics import sleep_analysis
from .models import Scenario
from .simulation import BASELINE, UNITS, dataset, daily_trend
from .wellness import summary


MISSION_NAME = "Ares Pathfinder"


def overview(scenario: Scenario, day: int = 30) -> dict:
    days = dataset(scenario)[:day]
    today = days[-1]
    sleep = sleep_analysis(scenario, day=day)
    current = summary(scenario, include_notes=False, day=day)["current"]
    metrics = {}
    for metric, baseline in BASELINE.items():
        value = today[metric]
        limits = {"heartRate": 8, "temperature": 0.5, "spo2": 2, "sleepHours": 0.8}
        state = "watch" if abs(value - baseline) > limits[metric] else "stable"
        metrics[metric] = {
            "value": value, "unit": UNITS[metric], "baseline": baseline,
            "delta": daily_trend(days, metric), "state": state,
            "history": [day[metric] for day in days[-12:]],
        }
    return {
        "scenario": scenario, "simulation": True, "name": "Maya Chen", "mission": MISSION_NAME,
        "role": "Mission Specialist", "crewId": "AST-01", "day": today["day"], "date": today["date"],
        "destination": "Mars", "phase": "Outbound transit", "plannedDays": 210,
        "metrics": metrics, "sleep": sleep, "wellness": current,
    }
