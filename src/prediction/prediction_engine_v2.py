"""
Prediction engine v2 -- Bayesian shrinkage toward literature-derived priors.

METHODOLOGY
-----------
Published menstrual-cycle prediction models (Huang, Elliott & Harlow 2010,
Bayesian changepoint models for cycle mean/variance; Li et al. 2022, JAMIA,
Bayesian hierarchical model for next-cycle-start prediction; Duttweiler et
al. 2025, "SkipTrack") share a common principle: an individual's predicted
cycle length should be a precision-weighted blend of (a) what's typical for
someone like them, and (b) their own observed cycles -- with the blend
shifting toward (b) as more personal data accumulates.

This module implements that principle as a simplified, fully transparent
conjugate normal-normal Bayesian update. It is NOT a reimplementation of
those papers' full state-space/MCMC machinery -- it's a lightweight
approximation of the same shrinkage logic, chosen because it needs no
external Bayesian inference library and remains auditable end to end.

    posterior_mean = (n/sigma_obs^2 * mean_obs + 1/sigma_prior^2 * mu_prior)
                     / (n/sigma_obs^2 + 1/sigma_prior^2)
    posterior_var  = 1 / (n/sigma_obs^2 + 1/sigma_prior^2)

With few logged cycles, the prediction leans on the population/condition
prior. As more cycles accumulate, it leans on the individual's own pattern.
This also means a user who starts treatment (e.g. levothyroxine for
hypothyroidism) will see their prediction drift away from the condition
prior and toward their improving personal average automatically.

PRIORS -- sources and known limitations
----------------------------------------
- Regular cycles: mean 29.3 days, drawn from a 612,613-cycle real-world
  dataset (Bull et al. 2019, npj Digital Medicine). We did NOT find a
  precise population SD in the sources reviewed; 3.5 days is a
  conservative estimate consistent with the commonly cited ~24-38 day
  normal range (ACOG) and should be replaced with a fitted value once
  real user data is available.
- PCOS: Rotterdam criteria define irregularity as <21 or >35 days, or
  <8 cycles/year (multiple sources, e.g. clinicaltrials.gov NCT06124391).
  Reported means split by anovulation (~60 days) vs oligoovulation
  (~43 days) (Joham et al. 2022, Clinical Endocrinology). We use 46 days
  as a blended mean with a wide SD (14 days) reflecting that split --
  a real implementation should model these as distinct subtypes rather
  than one blended prior.
- Hypothyroidism: TSH elevation was significantly associated with
  oligomenorrhea, and reduced FT4 with menorrhagia (cross-sectional
  study, PMC11281884). We use a longer mean (33 days) with moderate SD.
- Hyperthyroidism: literature supports irregularity and lighter flow,
  but NOT a consistent direction of cycle-length change -- so unlike
  v1, this prior does NOT assume shorter cycles. We center it at the
  population mean with a wider SD to reflect unpredictability rather
  than a specific (unsupported) directional shift. This is a correction
  from v1, which had assumed a systematic shortening not well supported
  by the sources reviewed.
- Anemia: the literature treats anemia/iron deficiency as a CONSEQUENCE
  of heavy menstrual bleeding, not a driver of cycle *timing*
  irregularity (e.g. PMC5406716, ScienceDirect S2949838424000410). So
  anemia gets the SAME timing prior as "none" -- it should influence
  flow/flagging logic (see report_generator.py), not the date
  prediction itself. This is a correction from v1, which had applied a
  bespoke (evidence-thin) cycle-length distribution to this group.

OUTLIER HANDLING
-----------------
v1 used an ad hoc median-based filter. v2 instead uses the practical
window applied in several published large-cohort analyses -- excluding
cycles outside a roughly 10-90 day window as likely tracking artifacts
or anovulatory outliers (approach summarized in Duttweiler et al. 2025,
citing Bull et al. 2019, Gibson et al. 2022, Li et al. 2023).
"""
import csv
import os
import random
import statistics
from collections import defaultdict
from datetime import datetime, timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
PLOTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "plots")

# (mu_prior_days, sigma_prior_days) -- see module docstring for sourcing per condition.
CONDITION_PRIORS = {
    "none":         (29.3, 3.5),   # Bull et al. 2019 (n=612,613 cycles)
    "pcos":         (46.0, 14.0),  # blended anovulatory (~60d) / oligoovulatory (~43d), Joham et al. 2022
    "hypothyroid":  (33.0, 6.0),   # oligomenorrhea association, PMC11281884
    "hyperthyroid": (29.3, 7.0),   # population-centered; wide SD for documented irregularity, no supported direction
    "anemia":       (29.3, 3.5),   # same as "none": anemia is a flow/consequence signal, not a timing driver
}

# Cycles outside this window are treated as probable tracking artifacts or
# anovulatory outliers and excluded from the individual likelihood estimate,
# consistent with the practical window used in several large cohort studies.
PLAUSIBLE_CYCLE_WINDOW = (10, 90)

LUTEAL_PHASE_DAYS = 12.4  # Bull et al. 2019 mean; range 7-17 in that cohort


def load_cycles_by_user():
    cycles = {}
    with open(f"{DATA_DIR}/cycle_logs.csv") as f:
        for row in csv.DictReader(f):
            if not row["cycle_length_days"]:
                continue
            cycles.setdefault(row["user_id"], []).append({
                "start": datetime.fromisoformat(row["cycle_start_date"]),
                "length": int(row["cycle_length_days"]),
            })
    for uid in cycles:
        cycles[uid].sort(key=lambda c: c["start"])
    return cycles


def classify_pcos_subtype(lengths):
    """
    PCOS is not one distribution -- Joham et al. (2022) report distinct means
    for anovulatory (~60d) vs oligoovulatory (~43d) presentations. Rather than
    shrinking every PCOS user toward one blended number, classify which
    subtype their own early pattern resembles and use that prior instead.
    This is a simple heuristic classifier, not a validated diagnostic tool --
    it exists to pick a *better starting prior*, nothing more.
    """
    if not lengths:
        return "pcos_oligoovulatory", (43.0, 10.0)
    long_fraction = sum(1 for l in lengths if l >= 55) / len(lengths)
    if long_fraction >= 0.3:
        return "pcos_anovulatory", (60.0, 16.0)
    return "pcos_oligoovulatory", (43.0, 10.0)


def tsh_informed_hypothyroid_prior(latest_tsh=None):
    """
    A cross-sectional study (PMC11281884) found a moderate positive
    correlation (r=0.35) between TSH level and severity of menstrual
    irregularity. We use that as a rough basis for nudging the prior mean
    with TSH severity, rather than using one fixed number for every
    hypothyroid user regardless of how controlled their levels are.

    IMPORTANT: the slope below is illustrative, calibrated only to match
    the qualitative direction and rough magnitude reported in the source
    study -- NOT a fitted regression coefficient. Treat this as a
    placeholder to replace with a real fitted slope once actual user
    (TSH, cycle length) pairs are available.
    """
    base_mu, base_sigma = CONDITION_PRIORS["hypothyroid"]
    if latest_tsh is None:
        return base_mu, base_sigma
    # Normal TSH upper bound ~4.0 mIU/L; nudge mean +0.8 days per mIU/L
    # above that, capped so a single extreme lab value can't dominate.
    excess = max(0.0, latest_tsh - 4.0)
    shifted_mu = base_mu + min(excess * 0.8, 15.0)
    return shifted_mu, base_sigma


def load_conditions():
    conditions = {}
    with open(f"{DATA_DIR}/users.csv") as f:
        for row in csv.DictReader(f):
            conditions[row["user_id"]] = row["diagnosed_conditions"] or "none"
    return conditions


def filter_plausible(lengths):
    lo, hi = PLAUSIBLE_CYCLE_WINDOW
    kept = [l for l in lengths if lo <= l <= hi]
    return kept if kept else lengths


def bayesian_shrinkage_predict(lengths, condition, latest_tsh=None):
    """Precision-weighted blend of condition prior and individual likelihood."""
    if condition == "pcos":
        _, (mu_prior, sigma_prior) = classify_pcos_subtype(lengths)
    elif condition == "hypothyroid":
        mu_prior, sigma_prior = tsh_informed_hypothyroid_prior(latest_tsh)
    else:
        mu_prior, sigma_prior = CONDITION_PRIORS.get(condition, CONDITION_PRIORS["none"])

    plausible = filter_plausible(lengths)
    n = len(plausible)

    if n == 0:
        # No usable individual data yet -- fall back entirely to the prior,
        # so predictive uncertainty is just the prior's own spread.
        return mu_prior, sigma_prior, sigma_prior, 0

    mean_obs = statistics.mean(plausible)
    # Individual variance estimate; needs >=2 points to compute directly.
    # With a single cycle, assume prior-level variance for the individual
    # (we simply don't know their personal spread yet).
    sigma_obs = statistics.stdev(plausible) if n >= 2 else sigma_prior
    sigma_obs = max(sigma_obs, 1.0)  # avoid division blow-up on near-zero variance

    precision_prior = 1 / (sigma_prior ** 2)
    precision_obs = n / (sigma_obs ** 2)

    posterior_mean = (precision_obs * mean_obs + precision_prior * mu_prior) / (precision_obs + precision_prior)
    # This is the uncertainty in *estimating the user's true average cycle
    # length* -- it correctly shrinks as more cycles are observed. On its
    # own it is NOT the right quantity for a next-cycle prediction interval
    # (see predictive_sd below); it's kept here because it's diagnostically
    # useful ("how well do we know this person's typical cycle").
    mean_estimate_var = 1 / (precision_obs + precision_prior)

    # Posterior PREDICTIVE variance for one new cycle = uncertainty in the
    # mean + the individual's own residual variance around that mean. A
    # single upcoming cycle can land far from someone's average even when
    # the average itself is well estimated -- this is the standard
    # correction for predicting a new draw rather than a population
    # parameter, and it's the number that should actually drive a
    # "predicted date +/- N days" claim.
    predictive_var = mean_estimate_var + sigma_obs ** 2
    predictive_sd = predictive_var ** 0.5

    return posterior_mean, predictive_sd, mean_estimate_var ** 0.5, n


def predict_next_cycle(user_cycles, condition):
    lengths_all = [c["length"] for c in user_cycles]
    if not lengths_all:
        return None

    posterior_mean, predictive_sd, mean_estimate_sd, n_used = bayesian_shrinkage_predict(lengths_all, condition)

    # 95% interval from the PREDICTIVE SD (~1.96x), rounded to whole days.
    ci_95 = round(predictive_sd * 1.96)

    last_start = user_cycles[-1]["start"]
    predicted_start = last_start + timedelta(days=round(posterior_mean))
    predicted_ovulation = predicted_start - timedelta(days=round(LUTEAL_PHASE_DAYS))

    return {
        "predicted_next_start": predicted_start.date().isoformat(),
        "confidence_interval_days": ci_95,
        "predicted_cycle_length": round(posterior_mean, 1),
        "predictive_sd": round(predictive_sd, 1),
        "mean_estimate_sd": round(mean_estimate_sd, 1),
        "n_cycles_used": n_used,
        "predicted_ovulation_date": predicted_ovulation.date().isoformat(),
        "method_used": "bayesian_shrinkage_v2",
    }


CONDITION_ORDER = ["none", "pcos", "hypothyroid", "hyperthyroid", "anemia"]
CONDITION_LABELS = ["Regular", "PCOS", "Hypothyroid", "Hyperthyroid", "Anemia"]
CONDITION_COLORS = ["#5F5E5A", "#D85A30", "#378ADD", "#1D9E75", "#D4537E"]


def plot_five_users_per_condition_with_prediction(cycles_by_user, conditions, seed=7):
    """
    5-panel figure -- one panel per condition (none, PCOS, hypothyroid,
    hyperthyroid, anemia) -- each showing 5 randomly sampled users' logged
    cycle-length history as a solid line, with their NEXT predicted cycle
    plotted as a shaded box: x-span = predicted_next_start +/- CI (the
    date uncertainty), y-position = predicted_cycle_length. A dashed
    connector links the last real cycle to the predicted one so the
    transition from "observed" to "predicted" is visually obvious.
    """
    rng = random.Random(seed)
    users_by_condition = defaultdict(list)
    for uid, cond in conditions.items():
        users_by_condition[cond].append(uid)

    fig, axes = plt.subplots(5, 1, figsize=(9, 20))

    for ax, cond, label, base_color in zip(axes, CONDITION_ORDER, CONDITION_LABELS, CONDITION_COLORS):
        candidates = [u for u in users_by_condition.get(cond, []) if u in cycles_by_user]
        sample = rng.sample(candidates, min(5, len(candidates)))

        for uid in sample:
            user_cycles = cycles_by_user[uid]
            dates = [c["start"] for c in user_cycles]
            lengths = [c["length"] for c in user_cycles]
            line, = ax.plot(dates, lengths, marker="o", markersize=3, linewidth=1,
                             alpha=0.85, label=uid)
            color = line.get_color()

            prediction = predict_next_cycle(user_cycles, cond)
            if prediction is None:
                continue

            pred_date = datetime.fromisoformat(prediction["predicted_next_start"])
            pred_length = prediction["predicted_cycle_length"]
            ci = prediction["confidence_interval_days"]

            # Dashed connector from last observed cycle to the prediction.
            ax.plot([dates[-1], pred_date], [lengths[-1], pred_length],
                     linestyle="--", linewidth=1, color=color, alpha=0.6)

            # Shaded box: x = date uncertainty (+/- CI), y = a fixed band
            # around the predicted cycle length, purely for visibility.
            box_x_start = pred_date - timedelta(days=ci)
            box_width_days = 2 * ci if ci > 0 else 1
            box_y_start = pred_length - 1.5
            rect = Rectangle(
                (box_x_start, box_y_start), timedelta(days=box_width_days), 3,
                facecolor=color, alpha=0.25, edgecolor=color, linewidth=0.8,
            )
            ax.add_patch(rect)
            ax.scatter([pred_date], [pred_length], marker="*", s=90, color=color,
                       edgecolor="black", linewidth=0.5, zorder=5)

        ax.set_title(f"{label} -- 5 sample users (\u2605 = predicted next cycle, shaded = \u00b1CI window)",
                     fontsize=10, loc="left")
        ax.set_ylabel("Cycle length (days)")
        ax.legend(fontsize=7, loc="upper left", ncol=5)
        ax.tick_params(axis="x", rotation=20, labelsize=8)

    fig.tight_layout()
    os.makedirs(PLOTS_DIR, exist_ok=True)
    out_path = f"{PLOTS_DIR}/five_users_per_condition_with_prediction.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def main():
    cycles_by_user = load_cycles_by_user()
    conditions = load_conditions()

    rows = []
    for user_id, cycles in cycles_by_user.items():
        condition = conditions.get(user_id, "none")
        result = predict_next_cycle(cycles, condition)
        if result:
            rows.append({"user_id": user_id, "condition": condition, **result})

    out_path = f"{DATA_DIR}/predictions_v2.csv"
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} predictions to {out_path}")
    seen = set()
    for r in rows:
        if r["condition"] not in seen:
            seen.add(r["condition"])
            print(r)

    plot_path = plot_five_users_per_condition_with_prediction(cycles_by_user, conditions)
    print(f"Wrote plot to {plot_path}")


if __name__ == "__main__":
    main()