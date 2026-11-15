from .simulation import dataset
from .situations import active_situations, situations

CREW_IDS = ("AST-01", "AST-02", "AST-03", "AST-04", "AST-05", "AST-06")
ROSTER = (
    ("Maya Chen", "Mission Specialist", "active", "Monitoring the flight console.", 0, 0),
    ("Amara Okafor", "Commander", "active", "Leading the shift handover.", -4, .35),
    ("Leo Martínez", "Flight Engineer", "resting", "Scheduled rest period after maintenance.", 3, .55),
    ("Priya Shah", "Medical Officer", "exercising", "Scheduled conditioning session.", 8, .15),
    ("Elena Walker", "Science Officer", "off_duty", "Completed the laboratory shift.", -2, .65),
    ("Noah Park", "Pilot", "pending", "Routine check-in is pending.", 2, -.25),
)


def crew_status(scenario, day):
    rows = dataset(scenario)[max(0, day - 7):day]
    pulse = active_situations(situations).read().heart_rate_bpm
    crew = []
    for index, (name, role, status, observation, heart_offset, sleep_offset) in enumerate(ROSTER):
        trend = [{"day": row["day"], "hours": round(max(0, row["sleepHours"] + sleep_offset), 2)} for row in rows]
        heart = pulse if index == 0 and pulse is not None else rows[-1]["heartRate"] + heart_offset
        crew.append({
            "id": CREW_IDS[index], "name": name, "role": role, "status": status, "heartRate": heart,
            "sleepHours": trend[-1]["hours"], "sleepTrend": trend,
            "wellness": "check_in_due" if status == "pending" else "routine",
            "lastCheckInDay": day if status != "pending" else day - 1 or None,
            "observation": observation,
        })
    return {"source": "synthetic_simulation", "day": day, "members": crew}
