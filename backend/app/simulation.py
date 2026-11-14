from datetime import date, timedelta
from functools import lru_cache
from random import Random
from statistics import mean

from .models import Scenario, Metric, Span

START = date(2026, 10, 16)
DAYS = 30
BASELINE = {"heartRate": 67, "temperature": 36.6, "spo2": 98, "sleepHours": 7.8}
UNITS = {"heartRate": "bpm", "temperature": "°C", "spo2": "%", "sleepHours": "h"}


def clock(minutes: int) -> str:
    hours, minutes = divmod(minutes % 1440, 60)
    return f"{hours:02}:{minutes:02}"


@lru_cache(maxsize=len(Scenario))
def dataset(scenario: Scenario) -> tuple[dict, ...]:
    rng = Random(214)
    days = []
    for day in range(1, DAYS + 1):
        duration = round(rng.uniform(7.3, 8.4) * 60)
        bedtime = 22 * 60 + rng.randint(-25, 25)
        awakenings = rng.randrange(3)
        stress = rng.randint(1, 3)
        if scenario == Scenario.SHORT_SLEEP and day in (9, 17, 26, 27, 28, 29, 30):
            duration = {9: 392, 17: 350, 26: 382, 27: 347, 28: 331, 29: 359, 30: 372}[day]
            bedtime += 68 if day >= 26 else 35
            awakenings += 1
            stress = min(4, stress + 1)
        if scenario == Scenario.SHIFT and day >= 21:
            bedtime += [115, -75, 155, -90][day % 4]
        if scenario == Scenario.STRESS and day >= 23:
            stress = min(5, stress + 2)
        if scenario == Scenario.RECOVERY and day >= 21:
            duration = min(485, 305 + (day - 21) * 22)
            stress = max(1, stress + (1 if day < 25 else -1))

        sleep_loss = max(0, 7.5 - duration / 60)
        heart = 67 + rng.randint(-4, 4) + round(sleep_loss * 2)
        temp = round(36.6 + rng.uniform(-0.21, 0.21), 1)
        spo2 = rng.choice([97, 98, 98, 99])
        asleep_minutes = duration
        wake_minutes = bedtime + asleep_minutes
        # Symmetric hourly offsets preserve the daily physiological mean.
        offsets = [rng.randint(-4, 4) for _ in range(12)]
        hourly = []
        for hour, offset in enumerate(offsets + [-value for value in offsets]):
            start, end = hour * 60, (hour + 1) * 60
            sleep_overlap = sum(
                max(0, min(end, wake_minutes - shift) - max(start, bedtime - shift))
                for shift in (0, 1440)
            )
            hourly.append({
                "label": f"{hour:02}:00", "heartRate": heart + offset,
                "temperature": round(temp + offset * 0.02, 2),
                "spo2": spo2 + (1 if offset > 2 else -1 if offset < -2 else 0),
                "sleepHours": sleep_overlap / 60,
            })
        days.append({
            "day": day, "date": (START + timedelta(days=day - 1)).isoformat(),
            "heartRate": heart, "temperature": temp, "spo2": spo2,
            "sleepHours": round(asleep_minutes / 60, 2),
            "sleep": {
                "bedtime": clock(bedtime), "wakeTime": clock(wake_minutes),
                "durationMinutes": asleep_minutes, "awakenings": awakenings,
                "quality": max(1, 5 - awakenings - round(sleep_loss)),
                "scheduleOffset": abs(bedtime - 22 * 60),
            },
            "stress": stress, "mood": max(1, min(5, 6 - stress)),
            "energy": max(1, min(5, 5 - round(sleep_loss))),
            "hourly": hourly,
        })
    return tuple(days)


def vitals(scenario: Scenario, metric: Metric, span: Span, day: int = DAYS) -> dict:
    days = dataset(scenario)[:day]
    key = metric.value
    is_hourly = span == Span.DAY
    if is_hourly:
        points = [{"label": row["label"], "value": row[key]} for row in days[-1]["hourly"]]
    else:
        count = 7 if span == Span.WEEK else 30
        points = [{"label": row["date"], "day": row["day"], "value": row[key]} for row in days[-count:]]
    return {
        "scenario": scenario, "metric": metric, "range": span, "unit": UNITS[key],
        "baseline": BASELINE[key] / 24 if is_hourly and metric == Metric.SLEEP else BASELINE[key],
        "points": points,
    }


def daily_trend(days: tuple[dict, ...], metric: str) -> float:
    previous = days[-8:-1]
    return round(days[-1][metric] - mean(day[metric] for day in previous), 2) if previous else 0.0
