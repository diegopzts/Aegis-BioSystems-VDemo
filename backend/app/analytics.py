from dataclasses import dataclass
from statistics import mean
from .models import Scenario
from .simulation import BASELINE, dataset


@dataclass(frozen=True)
class SleepRules:
    short_minutes: int = 420
    attention_minutes: int = 360
    irregular_offset: int = 60
    persistent_nights: int = 3
    weekly_change: float = 0.25


def status(sleep: dict, rules: SleepRules) -> str:
    if sleep["durationMinutes"] < rules.attention_minutes:
        return "attention"
    if sleep["durationMinutes"] < rules.short_minutes or sleep["scheduleOffset"] >= rules.irregular_offset:
        return "irregular"
    return "favorable"


def calendar(scenario: Scenario, rules: SleepRules = SleepRules(), *, day: int = 30) -> list[dict]:
    return [
        {
            "day": day["day"], "date": day["date"], "hours": day["sleepHours"],
            **day["sleep"], "status": status(day["sleep"], rules),
            "regular": day["sleep"]["scheduleOffset"] < rules.irregular_offset,
        }
        for day in dataset(scenario)[:day]
    ]


def sleep_analysis(scenario: Scenario, rules: SleepRules = SleepRules(), *, day: int = 30) -> dict:
    days = calendar(scenario, rules, day=day)
    recent = days[-7:]
    weekly = mean(day["durationMinutes"] for day in recent) / 60
    previous_days = days[-14:-7]
    previous = mean(day["durationMinutes"] for day in previous_days) / 60 if previous_days else weekly
    monthly = mean(day["durationMinutes"] for day in days) / 60
    delta = weekly - previous
    streak = longest = 0
    for day in days:
        streak = streak + 1 if day["durationMinutes"] < rules.short_minutes else 0
        longest = max(streak, longest)
    irregular = [day["day"] for day in recent if not day["regular"]]
    short_days = [day["day"] for day in recent if day["durationMinutes"] < rules.short_minutes]
    attention = [day["day"] for day in days if day["status"] == "attention"]
    recommendations = []
    if streak >= rules.persistent_nights:
        recommendations.append({
            "title": "Protect a recovery window",
            "reason": f"{streak} consecutive nights below {rules.short_minutes / 60:g} h.",
            "action": "Log fatigue and consider a recovery break. Check in with crew support if the pattern persists.",
            "days": [day["day"] for day in days[-streak:]], "level": "attention",
        })
    if len(irregular) >= 2:
        recommendations.append({
            "title": "Review your sleep schedule",
            "reason": f"{len(irregular)} nights started at least {rules.irregular_offset} minutes from the usual bedtime this week.",
            "action": "Review cabin lighting and use a consistent wind-down window.",
            "days": irregular, "level": "irregular",
        })
    if short_days and streak < rules.persistent_nights:
        recommendations.append({
            "title": "Track recent short nights",
            "reason": f"{len(short_days)} nights below {rules.short_minutes / 60:g} h this week.",
            "action": "Record how rested you feel and look for patterns over the next few days.",
            "days": short_days, "level": "irregular",
        })
    if not recommendations:
        recommendations.append({
            "title": "Keep logging your routine",
            "reason": f"Weekly average: {weekly:.1f} h. No short nights or repeated schedule shifts this week.",
            "action": "Keep recording sleep and how rested you feel.",
            "days": [day["day"] for day in recent], "level": "favorable",
        })
    trend = "rising" if delta >= rules.weekly_change else "falling" if delta <= -rules.weekly_change else "steady"
    return {
        "weeklyAverage": round(weekly, 2), "monthlyAverage": round(monthly, 2),
        "weeklySampleDays": len(recent), "missionSampleDays": len(days), "previousSampleDays": len(previous_days),
        "rules": {"shortMinutes": rules.short_minutes, "attentionMinutes": rules.attention_minutes,
                  "irregularOffset": rules.irregular_offset, "persistentNights": rules.persistent_nights},
        "baseline": BASELINE["sleepHours"], "baselineDelta": round(weekly - BASELINE["sleepHours"], 2),
        "streak": streak, "longestStreak": longest, "irregularDays": irregular, "shortDays": short_days,
        "attentionDays": attention, "trend": trend, "weeklyChange": round(delta, 2),
        "recommendations": recommendations,
    }
