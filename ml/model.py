"""Replaceable FemNova prediction baseline.

This dependency-free module demonstrates the training artifact and inference contract.
It is not clinically validated and must never be presented as diagnostic software.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MODEL_VERSION = "baseline-1.0.0"
DEFAULT_RANGES = {
    "ft3": {"low": 2.3, "high": 4.2, "unit": "pg/mL"},
    "ft4": {"low": 0.8, "high": 1.8, "unit": "ng/dL"},
    "tsh": {"low": 0.4, "high": 4.0, "unit": "mIU/L"},
    "hb": {"low": 12.0, "high": 15.5, "unit": "g/dL"},
}


@dataclass
class Prediction:
    test: str
    predicted_value: float
    unit: str
    confidence: float
    status: str
    direction: str | None
    delta: float


def evaluate(value: float, reference: dict[str, float | str]) -> tuple[str, str | None, float]:
    low = float(reference["low"])
    high = float(reference["high"])
    if value < low:
        return "out_of_range", "low", round(low - value, 2)
    if value > high:
        return "out_of_range", "high", round(value - high, 2)
    margin = (high - low) * 0.1
    if value <= low + margin:
        return "borderline", "low", round(value - low, 2)
    if value >= high - margin:
        return "borderline", "high", round(high - value, 2)
    return "normal", None, 0.0


def predict(features: dict[str, Any], ranges: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    references = ranges or DEFAULT_RANGES
    fatigue = max(0, int(features.get("fatigue_reports", 0)))
    low_energy = max(0, int(features.get("low_energy_days", 0)))
    heavy_flow = max(0, int(features.get("heavy_flow_days", 0)))
    dizziness = max(0, int(features.get("dizziness_reports", 0)))
    tracked_days = max(0, int(features.get("tracked_days", 0)))
    past_panels = max(0, int(features.get("past_lab_panels", 0)))
    prior = features.get("latest_values", {})
    modifiers = {
        "ft3": -(fatigue * 0.025 + low_energy * 0.015),
        "ft4": -(fatigue * 0.012 + low_energy * 0.006),
        "tsh": fatigue * 0.08 + low_energy * 0.04,
        "hb": -(heavy_flow * 0.12 + dizziness * 0.08 + fatigue * 0.035),
    }
    confidence = round(min(0.78, 0.38 + tracked_days * 0.006 + past_panels * 0.06), 2)
    outputs: list[Prediction] = []
    for test, reference in references.items():
        midpoint = (float(reference["low"]) + float(reference["high"])) / 2
        value = round(max(0, float(prior.get(test, midpoint)) + modifiers[test]), 2)
        status, direction, delta = evaluate(value, reference)
        outputs.append(Prediction(test, value, str(reference["unit"]), confidence, status, direction, delta))
    return {
        "model_version": MODEL_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "predictions": [asdict(output) for output in outputs],
        "explanation": "Deterministic baseline using tracked patterns and prior values when available.",
        "disclaimer": "Not a diagnosis or substitute for a laboratory test. Consult a qualified clinician.",
    }


def train(output: Path) -> None:
    artifact = {
        "model_version": MODEL_VERSION,
        "kind": "deterministic_baseline",
        "trained_at": datetime.now(UTC).isoformat(),
        "training_rows": 0,
        "validated": False,
        "note": "Stub artifact. Replace only after governed data collection, validation, and clinical review.",
    }
    output.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote model artifact to {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    train_parser = subparsers.add_parser("train")
    train_parser.add_argument("--output", type=Path, default=Path("ml/model-artifact.json"))
    predict_parser = subparsers.add_parser("predict")
    predict_parser.add_argument("features", type=Path)
    args = parser.parse_args()
    if args.command == "train":
        train(args.output)
    else:
        print(json.dumps(predict(json.loads(args.features.read_text(encoding="utf-8"))), indent=2))


if __name__ == "__main__":
    main()
