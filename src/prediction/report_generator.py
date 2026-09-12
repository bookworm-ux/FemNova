"""
Generates a clinician-facing PDF summary for one user: cycle trend chart,
variability stats, symptom frequency, lab values, and rule-based flags.

Explicitly NOT a diagnosis -- framed as a summary to support a clinical
conversation.
"""
import csv
import os
import statistics
import sys
from collections import Counter
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
)

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
REPORT_DIR = os.path.join(_PROJECT_ROOT, "reports")
os.makedirs(REPORT_DIR, exist_ok=True)


def load_user(user_id):
    with open(f"{DATA_DIR}/users.csv") as f:
        for row in csv.DictReader(f):
            if row["user_id"] == user_id:
                return row
    return None


def load_cycles(user_id):
    rows = []
    with open(f"{DATA_DIR}/cycle_logs.csv") as f:
        for row in csv.DictReader(f):
            if row["user_id"] == user_id:
                rows.append(row)
    rows.sort(key=lambda r: r["cycle_start_date"])
    return rows


def load_symptoms(user_id):
    rows = []
    with open(f"{DATA_DIR}/symptom_logs.csv") as f:
        for row in csv.DictReader(f):
            if row["user_id"] == user_id:
                rows.append(row)
    return rows


def load_labs(user_id):
    rows = []
    with open(f"{DATA_DIR}/lab_values.csv") as f:
        for row in csv.DictReader(f):
            if row["user_id"] == user_id:
                rows.append(row)
    rows.sort(key=lambda r: r["test_date"])
    return rows


def load_prediction(user_id):
    with open(f"{DATA_DIR}/predictions.csv") as f:
        for row in csv.DictReader(f):
            if row["user_id"] == user_id:
                return row
    return None


def make_cycle_chart(cycles, out_path):
    lengths = [int(c["cycle_length_days"]) for c in cycles if c["cycle_length_days"]]
    idx = list(range(1, len(lengths) + 1))
    plt.figure(figsize=(6.2, 2.6))
    plt.plot(idx, lengths, marker="o", markersize=3, linewidth=1, color="#7A3B8E")
    plt.axhspan(24, 34, color="#d8c2e6", alpha=0.3, label="typical 24-34d range")
    plt.xlabel("Cycle number")
    plt.ylabel("Cycle length (days)")
    plt.title("Cycle length over time")
    plt.legend(loc="upper left", fontsize=7, frameon=False)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close()


def flags_for(user, cycles, labs):
    flags = []
    lengths = [int(c["cycle_length_days"]) for c in cycles if c["cycle_length_days"]]
    condition = user["diagnosed_conditions"]

    if len(lengths) >= 3:
        std = statistics.stdev(lengths)
        if std > 8:
            flags.append("High cycle-length variability (SD > 8 days) — consider evaluating for PCOS or thyroid dysfunction if not already diagnosed.")
        long_cycles = sum(1 for l in lengths if l > 35)
        if long_cycles / len(lengths) > 0.3:
            flags.append("Frequent cycles >35 days — pattern consistent with oligomenorrhea.")

    flow_vals = [float(c["flow_intensity_avg"]) for c in cycles if c["flow_intensity_avg"]]
    if flow_vals and statistics.mean(flow_vals) >= 4.0:
        flags.append("Consistently heavy flow (avg intensity ≥4/5) — monitor for anemia; consider iron studies if not recent.")

    for lab in labs:
        try:
            val = float(lab["value"])
            lo, hi = float(lab["ref_range_low"]), float(lab["ref_range_high"])
        except (ValueError, TypeError):
            continue
        if val < lo or val > hi:
            flags.append(f"{lab['test_name']} out of reference range on {lab['test_date']}: {val} {lab['unit']} (ref {lo}-{hi}).")

    if not flags:
        flags.append("No rule-based flags triggered on current data.")
    return flags


def build_report(user_id):
    user = load_user(user_id)
    cycles = load_cycles(user_id)
    symptoms = load_symptoms(user_id)
    labs = load_labs(user_id)
    prediction = load_prediction(user_id)

    chart_path = f"{REPORT_DIR}/{user_id}_cycle_chart.png"
    make_cycle_chart(cycles, chart_path)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("TitleX", parent=styles["Title"], fontSize=18, spaceAfter=4)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], spaceBefore=14, spaceAfter=6)
    body = styles["Normal"]
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)

    doc = SimpleDocTemplate(
        f"{REPORT_DIR}/{user_id}_doctor_report.pdf",
        pagesize=letter,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        leftMargin=0.7 * inch, rightMargin=0.7 * inch,
    )
    story = []

    story.append(Paragraph("Menstrual Cycle Summary Report", title_style))
    story.append(Paragraph(f"Generated {datetime.now().date().isoformat()} — for clinical review", small))
    story.append(Spacer(1, 10))

    # Patient info table
    info_data = [
        ["Patient ID", user_id, "Age", user["age"]],
        ["Diagnosed conditions", user["diagnosed_conditions"], "Medications", user["medications"] or "—"],
    ]
    info_table = Table(info_data, colWidths=[110, 150, 110, 130])
    info_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0e6f5")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f0e6f5")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(info_table)

    # Cycle stats
    story.append(Paragraph("Cycle Statistics", h2))
    lengths = [int(c["cycle_length_days"]) for c in cycles if c["cycle_length_days"]]
    if lengths:
        stats_data = [
            ["Cycles logged", str(len(cycles))],
            ["Mean cycle length", f"{statistics.mean(lengths):.1f} days"],
            ["Std deviation", f"{statistics.stdev(lengths):.1f} days" if len(lengths) > 1 else "n/a"],
            ["Range", f"{min(lengths)}-{max(lengths)} days"],
        ]
        stats_table = Table(stats_data, colWidths=[180, 200])
        stats_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ]))
        story.append(stats_table)

    story.append(Spacer(1, 8))
    story.append(Image(chart_path, width=5.8 * inch, height=2.4 * inch))

    # Prediction
    if prediction:
        story.append(Paragraph("Current Prediction", h2))
        story.append(Paragraph(
            f"Next period predicted to start <b>{prediction['predicted_next_start']}</b> "
            f"(&plusmn;{prediction['confidence_interval_days']} days), based on "
            f"{prediction['n_cycles_used']} recent cycles.", body))

    # Symptom frequency
    story.append(Paragraph("Symptom Frequency (all logged entries)", h2))
    counts = Counter(s["symptom"] for s in symptoms)
    total_days_logged = len(set(s["log_date"] for s in symptoms)) or 1
    sym_data = [["Symptom", "Times logged", "% of logged days"]]
    for sym, cnt in counts.most_common(8):
        sym_data.append([sym.replace("_", " ").title(), str(cnt), f"{100*cnt/total_days_logged:.0f}%"])
    sym_table = Table(sym_data, colWidths=[180, 100, 120])
    sym_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7A3B8E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
    ]))
    story.append(sym_table)

    # Labs
    if labs:
        story.append(Paragraph("Lab Values (self-reported)", h2))
        lab_data = [["Date", "Test", "Value", "Unit", "Reference range"]]
        for lab in labs[-8:]:
            lab_data.append([
                lab["test_date"], lab["test_name"], lab["value"], lab["unit"],
                f"{lab['ref_range_low']}-{lab['ref_range_high']}"
            ])
        lab_table = Table(lab_data, colWidths=[75, 90, 60, 60, 115])
        lab_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7A3B8E")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ]))
        story.append(lab_table)

    # Flags
    story.append(Paragraph("Automated Flags for Clinical Review", h2))
    for flag in flags_for(user, cycles, labs):
        story.append(Paragraph(f"• {flag}", body))

    story.append(Spacer(1, 14))
    story.append(Paragraph(
        "This report is generated from self-reported app data and rule-based pattern "
        "detection. It is not a diagnosis and is intended solely to support discussion "
        "with a qualified healthcare provider.", small))

    doc.build(story)
    print(f"Report written to {REPORT_DIR}/{user_id}_doctor_report.pdf")


if __name__ == "__main__":
    user_id = sys.argv[1] if len(sys.argv) > 1 else "pcos_01"
    build_report(user_id)