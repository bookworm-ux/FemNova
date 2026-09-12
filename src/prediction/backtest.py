"""
Walk-forward backtest for the prediction engines.

Neither prediction_engine.py (v1) nor prediction_engine_v2.py (v2) is a
TRAINED model -- there's no learned parameters, so a conventional
train/test split doesn't apply. What we CAN measure: for each user, at
each point in their cycle history, use only the cycles BEFORE that point
to predict the next one, then compare against what actually happened.
This is walk-forward validation, standard for time-series-like data
where a normal random train/test split would leak future information
into the past.

CAVEAT (read before trusting these numbers):
This backtest runs on SYNTHETIC data generated using distributions
similar to what the model's own priors assume. Good backtest results
here mainly confirm the mechanism behaves as designed -- they are NOT
evidence of real-world accuracy. A real accuracy claim requires testing
against real user data the priors were not built from.
"""
import csv
import os
import statistics
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import prediction_engine as v1
import prediction_engine_v2 as v2

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
PLOTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "plots")

CONDITION_ORDER = ["none", "pcos", "hypothyroid", "hyperthyroid", "anemia"]
CONDITION_COLORS = {
    "none": "#5F5E5A", "pcos": "#D85A30", "hypothyroid": "#378ADD",
    "hyperthyroid": "#1D9E75", "anemia": "#D4537E",
}


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


def load_conditions():
    conditions = {}
    with open(f"{DATA_DIR}/users.csv") as f:
        for row in csv.DictReader(f):
            conditions[row["user_id"]] = row["diagnosed_conditions"] or "none"
    return conditions


def backtest_user(user_cycles, condition, min_history=3):
    """
    Walk forward through one user's cycles. At each step k >= min_history,
    predict cycle k+1 using only cycles[0:k], then compare to the actual
    cycle[k]. Returns a list of per-prediction results for both engines.
    """
    results_v1, results_v2 = [], []

    for k in range(min_history, len(user_cycles)):
        history_so_far = user_cycles[:k]
        actual_next = user_cycles[k]["length"]

        pred1 = v1.predict_next_cycle(history_so_far, condition)
        pred2 = v2.predict_next_cycle(history_so_far, condition)

        if pred1:
            predicted1 = pred1["predicted_cycle_length"]
            error1 = abs(predicted1 - actual_next)
            within_ci1 = error1 <= pred1["confidence_interval_days"]
            results_v1.append({
                "error": error1, "within_ci": within_ci1,
                "predicted": predicted1, "actual": actual_next, "condition": condition,
            })

        if pred2:
            predicted2 = pred2["predicted_cycle_length"]
            error2 = abs(predicted2 - actual_next)
            within_ci2 = error2 <= pred2["confidence_interval_days"]
            results_v2.append({
                "error": error2, "within_ci": within_ci2,
                "predicted": predicted2, "actual": actual_next, "condition": condition,
                "ci": pred2["confidence_interval_days"],
            })

    return results_v1, results_v2


def summarize(results, label):
    if not results:
        print(f"  {label}: no predictions made")
        return
    errors = [r["error"] for r in results]
    coverage = sum(1 for r in results if r["within_ci"]) / len(results)
    print(f"  {label}: n={len(results)}  MAE={statistics.mean(errors):.2f}d  "
          f"RMSE={(sum(e**2 for e in errors)/len(errors))**0.5:.2f}d  "
          f"within-CI={coverage*100:.0f}%")


def plot_predicted_vs_actual(all_v1, all_v2):
    """
    Two-panel scatter: predicted cycle length (x) vs actual cycle length
    (y), one panel per engine, points colored by condition. Points on the
    dashed y=x line are perfect predictions; the further a point sits from
    that line, the bigger the miss.
    """
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 6), sharex=True, sharey=True)

    for ax, results, title in [(ax1, all_v1, "v1: heuristic"), (ax2, all_v2, "v2: Bayesian shrinkage")]:
        for cond in CONDITION_ORDER:
            pts = [r for r in results if r["condition"] == cond]
            if not pts:
                continue
            xs = [r["predicted"] for r in pts]
            ys = [r["actual"] for r in pts]
            ax.scatter(xs, ys, label=cond, color=CONDITION_COLORS[cond], alpha=0.6, s=25)

        all_vals = [r["predicted"] for r in results] + [r["actual"] for r in results]
        lo, hi = min(all_vals) - 3, max(all_vals) + 3
        ax.plot([lo, hi], [lo, hi], color="gray", linestyle="--", linewidth=1, label="perfect prediction")
        ax.set_xlabel("Predicted cycle length (days)")
        ax.set_title(title)
        ax.legend(fontsize=8, loc="upper left")

    ax1.set_ylabel("Actual cycle length (days)")
    fig.suptitle("Backtest: predicted vs. actual cycle length (walk-forward)", fontsize=12)
    fig.tight_layout()
    os.makedirs(PLOTS_DIR, exist_ok=True)
    out_path = f"{PLOTS_DIR}/backtest_predicted_vs_actual.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_v2_with_error_bars(all_v2):
    """
    Single-panel predicted-vs-actual scatter for v2 ONLY, with each point's
    stated confidence interval drawn as a horizontal error bar on the
    predicted value. This is what plot_predicted_vs_actual() couldn't show:
    not just how close the point guess was, but whether the model's own
    stated uncertainty was honest -- a point whose error bar reaches the
    y=x line "covered" the true outcome; one that doesn't was overconfident.
    """
    fig, ax = plt.subplots(figsize=(7.5, 7))

    # Need per-point CI; re-derive it since backtest_user() only stored
    # predicted/actual/condition. Recompute is avoided -- instead we
    # rebuild CI from error/within_ci is not exact, so this function
    # expects results that include "ci" (added below in main()).
    for cond in CONDITION_ORDER:
        pts = [r for r in all_v2 if r["condition"] == cond]
        if not pts:
            continue
        xs = [r["predicted"] for r in pts]
        ys = [r["actual"] for r in pts]
        cis = [r["ci"] for r in pts]
        ax.errorbar(xs, ys, xerr=cis, fmt="o", color=CONDITION_COLORS[cond],
                    alpha=0.55, markersize=4, elinewidth=1, capsize=2, label=cond)

    all_vals = [r["predicted"] for r in all_v2] + [r["actual"] for r in all_v2]
    lo, hi = min(all_vals) - 5, max(all_vals) + 5
    ax.plot([lo, hi], [lo, hi], color="gray", linestyle="--", linewidth=1, label="perfect prediction")
    ax.set_xlabel("Predicted cycle length (days), error bar = stated 95% CI")
    ax.set_ylabel("Actual cycle length (days)")
    ax.set_title("v2 (Bayesian shrinkage): predicted vs. actual, with confidence intervals")
    ax.legend(fontsize=8, loc="upper left")
    fig.tight_layout()
    os.makedirs(PLOTS_DIR, exist_ok=True)
    out_path = f"{PLOTS_DIR}/backtest_v2_error_bars.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_three_random_users_timeline(cycles_by_user, conditions, seed=None):
    """
    Timeline (broken-bar / Gantt style) for 3 randomly selected users:
    each of their ACTUAL logged periods drawn as a solid block, and their
    NEXT predicted period drawn as a hatched block in a different shade,
    spanning predicted_next_start +/- confidence_interval_days.
    """
    import random
    from datetime import timedelta
    from matplotlib.dates import date2num

    rng = random.Random(seed)
    all_users = [u for u in cycles_by_user if len(cycles_by_user[u]) >= 3]
    sample = rng.sample(all_users, min(3, len(all_users)))

    fig, axes = plt.subplots(len(sample), 1, figsize=(11, 2.2 * len(sample) + 1), sharex=False)
    if len(sample) == 1:
        axes = [axes]

    period_lengths = {}
    with open(f"{DATA_DIR}/cycle_logs.csv") as f:
        for row in csv.DictReader(f):
            if row["period_length_days"]:
                period_lengths.setdefault(row["user_id"], []).append(
                    (row["cycle_start_date"], int(row["period_length_days"]))
                )

    for ax, user_id in zip(axes, sample):
        cond = conditions.get(user_id, "none")
        actual_color = CONDITION_COLORS.get(cond, "#5F5E5A")

        bars = []
        for start_str, plen in period_lengths.get(user_id, []):
            start = datetime.fromisoformat(start_str)
            bars.append((date2num(start), plen))
        ax.broken_barh(bars, (0.4, 0.6), facecolors=actual_color, alpha=0.8, label="actual period")

        prediction = v2.predict_next_cycle(cycles_by_user[user_id], cond)
        if prediction:
            pred_date = datetime.fromisoformat(prediction["predicted_next_start"])
            ci = prediction["confidence_interval_days"]
            window_start = pred_date - timedelta(days=ci)
            window_width = 2 * ci if ci > 0 else 1
            ax.broken_barh([(date2num(window_start), window_width)], (0.4, 0.6),
                            facecolors="none", edgecolor=actual_color, hatch="//",
                            linewidth=1.2, alpha=0.9, label="predicted next period (\u00b1CI)")

        ax.set_yticks([])
        ax.set_title(f"{user_id}  ({cond})", fontsize=10, loc="left")
        ax.legend(fontsize=7, loc="upper left")
        ax.xaxis_date()
        ax.tick_params(axis="x", labelsize=8, rotation=20)

    fig.suptitle("Actual vs. predicted period timeline -- 3 random users", fontsize=12)
    fig.tight_layout()
    os.makedirs(PLOTS_DIR, exist_ok=True)
    out_path = f"{PLOTS_DIR}/three_users_timeline.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def main():
    cycles_by_user = load_cycles_by_user()
    conditions = load_conditions()

    all_v1, all_v2 = [], []
    by_condition_v1, by_condition_v2 = {}, {}

    for user_id, cycles in cycles_by_user.items():
        condition = conditions.get(user_id, "none")
        r1, r2 = backtest_user(cycles, condition)
        all_v1.extend(r1)
        all_v2.extend(r2)
        by_condition_v1.setdefault(condition, []).extend(r1)
        by_condition_v2.setdefault(condition, []).extend(r2)

    print("=" * 70)
    print("OVERALL (all conditions pooled)")
    print("=" * 70)
    summarize(all_v1, "v1 (heuristic)      ")
    summarize(all_v2, "v2 (Bayesian shrink)")

    print()
    print("=" * 70)
    print("BY CONDITION")
    print("=" * 70)
    for cond in ["none", "pcos", "hypothyroid", "hyperthyroid", "anemia"]:
        print(f"\n{cond}:")
        summarize(by_condition_v1.get(cond, []), "v1")
        summarize(by_condition_v2.get(cond, []), "v2")

    print()
    print("Reminder: this is a backtest on SYNTHETIC data generated using")
    print("distributions similar to the model's own priors. Treat as a")
    print("mechanism check, not a real-world accuracy claim.")

    plot_path = plot_predicted_vs_actual(all_v1, all_v2)
    print(f"\nWrote plot to {plot_path}")

    error_bar_path = plot_v2_with_error_bars(all_v2)
    print(f"Wrote plot to {error_bar_path}")

    timeline_path = plot_three_random_users_timeline(cycles_by_user, conditions)
    print(f"Wrote plot to {timeline_path}")


if __name__ == "__main__":
    main()