"""
Period prediction model -- Bayesian shrinkage, focused on PCOS and thyroid.

This is a self-contained model: give it one person's data as a dict,
get a prediction back as a dict. No files, no database required to run it.

METHOD (one paragraph)
-----------------------
Every prediction blends a "prior" (what's typical for someone with this
condition, from published research) with the person's own logged cycles,
weighted by how much personal data exists. Few logged cycles -> prediction
leans on the prior. Many logged cycles -> prediction leans on their own
pattern. PCOS additionally picks between two priors (mild vs. severe
subtype) based on the person's own cycle pattern. Hypothyroidism
additionally shifts its prior based on the person's latest TSH lab value,
if provided.
"""
import statistics
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# PRIORS -- (mean_days, std_days), sourced from published research.
# See REFERENCES.md for citations.
# ---------------------------------------------------------------------------
PRIORS = {
    "none":                  (29.3, 3.5),
    "pcos_oligoovulatory":   (43.0, 10.0),
    "pcos_anovulatory":      (60.0, 16.0),
    "hypothyroid":           (33.0, 6.0),
    "hyperthyroid":          (29.3, 7.0),
}
PLAUSIBLE_CYCLE_WINDOW = (10, 90)
LUTEAL_PHASE_DAYS = 12.4


class PeriodPredictionModel:

    def predict(self, input_data: dict) -> dict:
        """
        INPUT (dict):
        {
          "user_id": str,
          "condition": "none" | "pcos" | "hypothyroid" | "hyperthyroid",
          "cycle_history": [
              {"start_date": "YYYY-MM-DD", "length_days": int}, ...
          ],                                  # sorted oldest -> newest
          "latest_tsh": float | None           # optional, mIU/L, thyroid only
        }

        OUTPUT (dict):
        {
          "user_id": str,
          "condition": str,
          "predicted_next_period_start": "YYYY-MM-DD",
          "predicted_ovulation_date": "YYYY-MM-DD",
          "predicted_cycle_length_days": float,
          "confidence_interval_days": int,     # +/- days, 95%
          "n_cycles_used": int,
          "prior_used": {"label": str, "mean_days": float, "std_days": float},
          "pcos_subtype_detected": str | None,
          "method": "bayesian_shrinkage"
        }
        """
        condition = input_data.get("condition", "none")
        history = input_data.get("cycle_history", [])
        lengths = [c["length_days"] for c in history]
        latest_tsh = input_data.get("latest_tsh")

        prior_label, (mu_prior, sigma_prior) = self._select_prior(condition, lengths, latest_tsh)
        posterior_mean, predictive_sd, n_used = self._shrink(lengths, mu_prior, sigma_prior)

        ci_95 = round(predictive_sd * 1.96)

        if history:
            last_start = datetime.fromisoformat(history[-1]["start_date"])
        else:
            last_start = datetime.today()

        predicted_start = last_start + timedelta(days=round(posterior_mean))
        predicted_ovulation = predicted_start - timedelta(days=round(LUTEAL_PHASE_DAYS))

        return {
            "user_id": input_data.get("user_id"),
            "condition": condition,
            "predicted_next_period_start": predicted_start.date().isoformat(),
            "predicted_ovulation_date": predicted_ovulation.date().isoformat(),
            "predicted_cycle_length_days": round(posterior_mean, 1),
            "confidence_interval_days": ci_95,
            "n_cycles_used": n_used,
            "prior_used": {"label": prior_label, "mean_days": mu_prior, "std_days": sigma_prior},
            "pcos_subtype_detected": prior_label if condition == "pcos" else None,
            "method": "bayesian_shrinkage",
        }

    # -- internals ----------------------------------------------------------

    def _select_prior(self, condition, lengths, latest_tsh):
        if condition == "pcos":
            long_fraction = (sum(1 for l in lengths if l >= 55) / len(lengths)) if lengths else 0
            label = "pcos_anovulatory" if long_fraction >= 0.3 else "pcos_oligoovulatory"
            return label, PRIORS[label]

        if condition == "hypothyroid":
            mu, sigma = PRIORS["hypothyroid"]
            if latest_tsh is not None:
                # Illustrative nudge, not a fitted regression -- see REFERENCES.md.
                excess = max(0.0, latest_tsh - 4.0)
                mu = mu + min(excess * 0.8, 15.0)
            return "hypothyroid", (mu, sigma)

        if condition in PRIORS:
            return condition, PRIORS[condition]

        return "none", PRIORS["none"]

    def _shrink(self, lengths, mu_prior, sigma_prior):
        lo, hi = PLAUSIBLE_CYCLE_WINDOW
        plausible = [l for l in lengths if lo <= l <= hi] or lengths
        n = len(plausible)

        if n == 0:
            return mu_prior, sigma_prior, 0

        mean_obs = statistics.mean(plausible)
        sigma_obs = statistics.stdev(plausible) if n >= 2 else sigma_prior
        sigma_obs = max(sigma_obs, 1.0)

        precision_prior = 1 / (sigma_prior ** 2)
        precision_obs = n / (sigma_obs ** 2)

        posterior_mean = (precision_obs * mean_obs + precision_prior * mu_prior) / (precision_obs + precision_prior)
        mean_estimate_var = 1 / (precision_obs + precision_prior)
        predictive_sd = (mean_estimate_var + sigma_obs ** 2) ** 0.5

        return posterior_mean, predictive_sd, n


if __name__ == "__main__":
    import json

    model = PeriodPredictionModel()

    print("=" * 60)
    print("EXAMPLE 1: New PCOS user, only 2 cycles logged")
    print("=" * 60)
    input_1 = {
        "user_id": "demo_pcos_new",
        "condition": "pcos",
        "cycle_history": [
            {"start_date": "2026-06-01", "length_days": 52},
            {"start_date": "2026-07-23", "length_days": 58},
        ],
        "latest_tsh": None,
    }
    print("INPUT:\n" + json.dumps(input_1, indent=2))
    print("\nOUTPUT:\n" + json.dumps(model.predict(input_1), indent=2))

    print("\n" + "=" * 60)
    print("EXAMPLE 2: Hypothyroid user, well-tracked, elevated TSH")
    print("=" * 60)
    input_2 = {
        "user_id": "demo_hypothyroid_established",
        "condition": "hypothyroid",
        "cycle_history": [
            {"start_date": "2026-01-05", "length_days": 35},
            {"start_date": "2026-02-09", "length_days": 34},
            {"start_date": "2026-03-15", "length_days": 36},
            {"start_date": "2026-04-19", "length_days": 33},
            {"start_date": "2026-05-23", "length_days": 35},
            {"start_date": "2026-06-27", "length_days": 34},
        ],
        "latest_tsh": 9.2,
    }
    print("INPUT:\n" + json.dumps(input_2, indent=2))
    print("\nOUTPUT:\n" + json.dumps(model.predict(input_2), indent=2))

    print("\n" + "=" * 60)
    print("EXAMPLE 3: Brand-new user, zero history, no condition")
    print("=" * 60)
    input_3 = {
        "user_id": "demo_new_user",
        "condition": "none",
        "cycle_history": [],
        "latest_tsh": None,
    }
    print("INPUT:\n" + json.dumps(input_3, indent=2))
    print("\nOUTPUT:\n" + json.dumps(model.predict(input_3), indent=2))
