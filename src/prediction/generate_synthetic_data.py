"""
Generates synthetic-but-realistic period tracking data for four cohorts:
regular, PCOS, thyroid (hypo/hyper mix), and anemia.

This is SYNTHETIC data for algorithm development/testing only --
not derived from real patients.
"""
import csv
import os
import random
import uuid
from datetime import date, timedelta

random.seed(42)

N_PER_GROUP = 6
MONTHS_OF_HISTORY = 20
START_DATE = date(2024, 1, 1)

users = []
cycle_logs = []
symptom_logs = []
lab_values = []


def add_days(d, n):
    return d + timedelta(days=int(round(n)))


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def gen_cycle_length(condition):
    """Returns a cycle length in days, sampled per condition profile."""
    if condition == "none":
        return clamp(random.gauss(28, 1.8), 24, 34)
    if condition == "pcos":
        # PCOS: long, highly variable cycles, occasional skipped cycles
        if random.random() < 0.12:
            return clamp(random.gauss(70, 15), 45, 120)  # skipped/anovulatory cycle
        return clamp(random.gauss(42, 11), 26, 90)
    if condition == "hypothyroid":
        return clamp(random.gauss(34, 5), 26, 50)
    if condition == "hyperthyroid":
        return clamp(random.gauss(23, 4), 15, 30)
    if condition == "anemia":
        # Cycle length close to typical, but see period_length/flow below
        return clamp(random.gauss(27, 3), 21, 35)
    return clamp(random.gauss(28, 2), 24, 34)


def gen_period_length_and_flow(condition):
    if condition == "anemia":
        period_len = clamp(round(random.gauss(8, 1.5)), 6, 12)
        flow = clamp(random.gauss(4.3, 0.5), 3, 5)
    elif condition == "hypothyroid":
        period_len = clamp(round(random.gauss(7, 1.5)), 4, 10)
        flow = clamp(random.gauss(3.8, 0.6), 2, 5)
    elif condition == "pcos":
        period_len = clamp(round(random.gauss(6, 2.5)), 2, 12)
        flow = clamp(random.gauss(3.2, 1.0), 1, 5)
    elif condition == "hyperthyroid":
        period_len = clamp(round(random.gauss(3, 1)), 1, 5)
        flow = clamp(random.gauss(2.0, 0.6), 1, 4)
    else:
        period_len = clamp(round(random.gauss(5, 1)), 3, 7)
        flow = clamp(random.gauss(2.8, 0.6), 1, 5)
    return int(period_len), round(flow, 1)


SYMPTOM_PROFILE = {
    "none": {"cramps": 0.7, "bloating": 0.5, "mood_swings": 0.4, "fatigue": 0.3, "headache": 0.3},
    "pcos": {"cramps": 0.5, "acne": 0.7, "hair_loss": 0.5, "mood_swings": 0.6, "fatigue": 0.5, "bloating": 0.6},
    "hypothyroid": {"fatigue": 0.85, "cold_intolerance": 0.7, "mood_swings": 0.5, "cramps": 0.5, "bloating": 0.4},
    "hyperthyroid": {"fatigue": 0.5, "hot_flashes": 0.75, "mood_swings": 0.6, "headache": 0.4},
    "anemia": {"fatigue": 0.9, "headache": 0.55, "heavy_bleeding": 0.8, "cramps": 0.6, "dizziness": 0.4},
}

COND_LABEL = {
    "none": "none",
    "pcos": "pcos",
    "hypothyroid": "hypothyroid",
    "hyperthyroid": "hyperthyroid",
    "anemia": "anemia",
}


def gen_lab_values(user_id, condition, log_date):
    entries = []
    if condition in ("hypothyroid", "hyperthyroid"):
        tsh = random.gauss(7.5, 2.0) if condition == "hypothyroid" else random.gauss(0.15, 0.08)
        entries.append((user_id, log_date.isoformat(), "TSH", round(max(tsh, 0.01), 2), "mIU/L", 0.4, 4.0))
        ft4 = random.gauss(0.6, 0.1) if condition == "hypothyroid" else random.gauss(2.4, 0.3)
        entries.append((user_id, log_date.isoformat(), "FT4", round(max(ft4, 0.1), 2), "ng/dL", 0.8, 1.8))
    elif condition == "anemia":
        hgb = random.gauss(9.8, 1.0)
        entries.append((user_id, log_date.isoformat(), "Hemoglobin", round(max(hgb, 6), 1), "g/dL", 12.0, 15.5))
        ferritin = random.gauss(12, 6)
        entries.append((user_id, log_date.isoformat(), "Ferritin", round(max(ferritin, 2), 1), "ng/mL", 15, 150))
    elif condition == "pcos":
        lh = random.gauss(14, 4)
        fsh = random.gauss(5.5, 1.2)
        entries.append((user_id, log_date.isoformat(), "LH", round(max(lh, 1), 1), "IU/L", 2.4, 12.6))
        entries.append((user_id, log_date.isoformat(), "FSH", round(max(fsh, 1), 1), "IU/L", 3.5, 12.5))
    else:
        entries.append((user_id, log_date.isoformat(), "TSH", round(random.gauss(2.0, 0.6), 2), "mIU/L", 0.4, 4.0))
    return entries


groups = ["none", "pcos", "hypothyroid", "hyperthyroid", "anemia"]

for condition in groups:
    for i in range(N_PER_GROUP):
        user_id = f"{condition}_{i+1:02d}"
        age = random.randint(18, 42)
        height = round(random.gauss(163, 6), 1)
        weight = round(random.gauss(78 if condition == "pcos" else 65, 10), 1)
        onset_year = random.randint(2018, 2023) if condition != "none" else None

        users.append({
            "user_id": user_id,
            "age": age,
            "height_cm": height,
            "weight_kg": weight,
            "diagnosed_conditions": COND_LABEL[condition],
            "medications": {
                "hypothyroid": "levothyroxine 50mcg",
                "hyperthyroid": "methimazole 10mg",
                "pcos": "metformin 500mg",
                "anemia": "ferrous sulfate 325mg",
                "none": ""
            }[condition],
            "condition_onset_year": onset_year if onset_year else "",
            "created_at": START_DATE.isoformat(),
        })

        # Simulate cycles across the history window
        cursor = START_DATE
        cycle_starts = []
        while cursor < add_days(START_DATE, MONTHS_OF_HISTORY * 30):
            cycle_starts.append(cursor)
            cursor = add_days(cursor, gen_cycle_length(condition))

        for idx, c_start in enumerate(cycle_starts):
            period_len, flow = gen_period_length_and_flow(condition)
            period_end = add_days(c_start, period_len - 1)
            cycle_len = None
            if idx + 1 < len(cycle_starts):
                cycle_len = (cycle_starts[idx + 1] - c_start).days

            ovulation_est = ""
            if cycle_len:
                ovulation_est = add_days(c_start, cycle_len - 14).isoformat()

            cycle_logs.append({
                "cycle_id": str(uuid.uuid4())[:8],
                "user_id": user_id,
                "cycle_start_date": c_start.isoformat(),
                "period_end_date": period_end.isoformat(),
                "period_length_days": period_len,
                "cycle_length_days": cycle_len if cycle_len else "",
                "flow_intensity_avg": flow,
                "ovulation_est_date": ovulation_est,
            })

            # Symptom logs during the period window (+ a few luteal-phase days)
            profile = SYMPTOM_PROFILE[condition]
            log_window_start = c_start
            log_window_end = add_days(c_start, period_len + 2)
            d = log_window_start
            while d <= log_window_end:
                for symptom, prob in profile.items():
                    if random.random() < prob:
                        symptom_logs.append({
                            "log_id": str(uuid.uuid4())[:8],
                            "user_id": user_id,
                            "log_date": d.isoformat(),
                            "symptom": symptom,
                            "severity": random.randint(2, 5),
                        })
                d = add_days(d, 1)

            # Lab values roughly every 3rd cycle
            if idx % 3 == 0:
                for row in gen_lab_values(user_id, condition, c_start):
                    lab_values.append({
                        "user_id": row[0], "test_date": row[1], "test_name": row[2],
                        "value": row[3], "unit": row[4], "ref_range_low": row[5], "ref_range_high": row[6],
                    })

# ---- write CSVs ----
# Resolve the data/ folder relative to this script's own location, so it
# works no matter where the project is checked out (works on Windows, Mac,
# Linux -- doesn't rely on the sandbox path this was originally written in).
script_dir = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(os.path.dirname(script_dir), "data")
os.makedirs(out_dir, exist_ok=True)

def write_csv(filename, rows, fieldnames):
    with open(f"{out_dir}/{filename}", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

write_csv("users.csv", users, list(users[0].keys()))
write_csv("cycle_logs.csv", cycle_logs, list(cycle_logs[0].keys()))
write_csv("symptom_logs.csv", symptom_logs, list(symptom_logs[0].keys()))
write_csv("lab_values.csv", lab_values, list(lab_values[0].keys()))

print(f"users: {len(users)}")
print(f"cycle_logs: {len(cycle_logs)}")
print(f"symptom_logs: {len(symptom_logs)}")
print(f"lab_values: {len(lab_values)}")