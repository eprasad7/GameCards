"""
Walk-forward backtesting for the pricing model.

Implements the evaluation framework from the spec:
- Walk-forward validation (train on past, test on future)
- Metrics stratified by volume bucket
- MdAPE, p10-p90 coverage, interval width, rank-aware quality signals
- Informational simulated trading P&L
"""

import json
import logging
from pathlib import Path

import click
import lightgbm as lgb
import numpy as np
import pandas as pd

from .config import TrainingConfig
from .train import load_training_data, train_quantile_models, classify_volume

logger = logging.getLogger(__name__)


def walk_forward_backtest(
    df: pd.DataFrame, config: TrainingConfig
) -> list[dict]:
    """
    Run walk-forward backtesting.

    |--- Train (12 months) ---|--- Test (1 month) ---|
                              |--- Train (13 months) ---|--- Test (1 month) ---|
    """
    feature_cols = [c for c in config.feature_columns if c in df.columns]
    df["month"] = df["sale_date"].dt.to_period("M")
    months = sorted(df["month"].unique())

    if len(months) < config.train_months + config.test_months + 1:
        logger.error(
            f"Insufficient data: {len(months)} months, "
            f"need at least {config.train_months + config.test_months + 1}"
        )
        return []

    results = []

    for i in range(config.train_months, len(months) - config.test_months + 1):
        train_start = months[max(0, i - config.train_months)]
        train_end = months[i - 1]
        test_month = months[i]

        train_df = df[(df["month"] >= train_start) & (df["month"] <= train_end)]
        test_df = df[df["month"] == test_month]

        if len(train_df) < config.min_train_samples:
            logger.warning(f"Skipping {test_month}: only {len(train_df)} train samples")
            continue

        if len(test_df) == 0:
            continue

        logger.info(
            f"Fold: train {train_start}-{train_end} ({len(train_df)}), "
            f"test {test_month} ({len(test_df)})"
        )

        # Train models for this fold
        models = train_quantile_models(train_df, config)

        # Evaluate
        X_test = test_df[feature_cols].values
        y_actual = np.expm1(test_df["log_price"].values)

        predictions = {}
        for q, model in models.items():
            predictions[q] = np.expm1(model.predict(X_test))

        y_pred = predictions[0.50]
        abs_pct_errors = np.abs(y_actual - y_pred) / np.maximum(y_actual, 1e-8)

        # Coverage of the p10-p90 interval (80% nominal interval)
        lower = predictions[0.10]
        upper = predictions[0.90]
        coverage = float(np.mean((y_actual >= lower) & (y_actual <= upper)) * 100)

        fold_result = {
            "test_month": str(test_month),
            "train_samples": len(train_df),
            "test_samples": len(test_df),
            "mdape": float(np.median(abs_pct_errors) * 100),
            "mae": float(np.mean(np.abs(y_actual - y_pred))),
            "coverage_p10_p90": coverage,
            "interval_width_pct": float(
                np.mean((upper - lower) / np.maximum(y_pred, 1e-8)) * 100
            ),
        }

        # Stratified metrics
        for bucket in ["high", "medium", "low"]:
            mask = test_df["volume_bucket"].values == bucket
            if mask.sum() > 0:
                fold_result[f"mdape_{bucket}"] = float(
                    np.median(abs_pct_errors[mask]) * 100
                )
                fold_result[f"count_{bucket}"] = int(mask.sum())

        # Informational only until we have a separate offer stream.
        buy_threshold = predictions[0.20]
        sell_threshold = predictions[0.80]
        pnl = simulate_trading(y_actual, y_pred, buy_threshold, sell_threshold)
        fold_result["simulated_pnl"] = pnl

        results.append(fold_result)
        logger.info(
            f"  MdAPE: {fold_result['mdape']:.1f}%, "
            f"Coverage(p10-p90): {fold_result['coverage_p10_p90']:.1f}%, "
            f"P&L: ${pnl:.2f}"
        )

    return results


def simulate_trading(
    actual: np.ndarray,
    predicted: np.ndarray,
    buy_threshold: np.ndarray,
    sell_threshold: np.ndarray,
) -> float:
    """
    Informational proxy for GameStop's trade-in pricing policy.

    Scenario: a customer walks in with a card. The actual market price
    (from a recent comparable sale) is the "offered price". The model's
    buy_threshold is the max price GameStop would pay.

    Decision rule (matches evaluate.ts):
      if actual_market_price < buy_threshold → BUY (profit = predicted - actual)
      if actual_market_price > sell_threshold → SELL (profit = actual - predicted)

    This still conditions decisions on the held-out target as a proxy for the
    offer stream, so it is useful for directional sanity checks only and should
    not be reported as an unbiased production P&L simulation.
    """
    total_pnl = 0.0
    for i in range(len(actual)):
        if actual[i] < buy_threshold[i]:
            # Market price below our max buy → profitable trade-in
            total_pnl += predicted[i] - actual[i]
        elif actual[i] > sell_threshold[i]:
            # Market price above our sell threshold → take profit
            total_pnl += actual[i] - predicted[i]
    return float(total_pnl)


def summarize_backtest(results: list[dict]) -> dict:
    """Aggregate fold results into a compact summary."""
    avg_mdape = np.mean([r["mdape"] for r in results])
    avg_coverage = np.mean([r["coverage_p10_p90"] for r in results])
    total_pnl = sum(r["simulated_pnl"] for r in results)

    return {
        "folds": len(results),
        "avg_mdape": round(float(avg_mdape), 2),
        "avg_coverage_p10_p90": round(float(avg_coverage), 2),
        "total_simulated_pnl": round(float(total_pnl), 2),
        "fold_results": results,
    }


def validate_backtest_summary(
    summary: dict,
    max_mdape: float | None = None,
    min_coverage_p10_p90: float | None = None,
    min_folds: int = 1,
) -> list[str]:
    """Return human-readable quality gate failures."""
    failures: list[str] = []

    folds = int(summary.get("folds", 0))
    if folds < min_folds:
        failures.append(f"fold count {folds} below minimum {min_folds}")

    avg_mdape = float(summary.get("avg_mdape", 0))
    if max_mdape is not None and avg_mdape > max_mdape:
        failures.append(f"avg_mdape {avg_mdape:.2f} exceeds maximum {max_mdape:.2f}")

    avg_coverage = float(summary.get("avg_coverage_p10_p90", 0))
    if min_coverage_p10_p90 is not None and avg_coverage < min_coverage_p10_p90:
        failures.append(
            f"avg_coverage_p10_p90 {avg_coverage:.2f} below minimum {min_coverage_p10_p90:.2f}"
        )

    return failures


@click.command()
@click.option("--data", required=True, help="Path to training data CSV")
@click.option("--output", default="backtest_results.json", help="Output file for results")
@click.option("--max-mdape", type=float, default=None, help="Fail if avg MdAPE exceeds this threshold")
@click.option("--min-coverage-p10-p90", type=float, default=None, help="Fail if avg p10-p90 coverage drops below this threshold")
@click.option("--min-folds", type=int, default=1, show_default=True, help="Minimum required walk-forward folds")
def cli(
    data: str,
    output: str,
    max_mdape: float | None,
    min_coverage_p10_p90: float | None,
    min_folds: int,
):
    """Run walk-forward backtesting."""
    logging.basicConfig(level=logging.INFO)

    config = TrainingConfig()
    df = load_training_data(data)
    results = walk_forward_backtest(df, config)

    if results:
        summary = summarize_backtest(results)

        Path(output).write_text(json.dumps(summary, indent=2))
        logger.info(f"\nBacktest Summary ({len(results)} folds):")
        logger.info(f"  Avg MdAPE: {summary['avg_mdape']:.1f}%")
        logger.info(f"  Avg Coverage (p10-p90): {summary['avg_coverage_p10_p90']:.1f}%")
        logger.info(f"  Total Simulated P&L: ${summary['total_simulated_pnl']:.2f}")
        logger.info(f"  Results saved to {output}")

        failures = validate_backtest_summary(
            summary,
            max_mdape=max_mdape,
            min_coverage_p10_p90=min_coverage_p10_p90,
            min_folds=min_folds,
        )
        if failures:
            for failure in failures:
                logger.error(f"QUALITY GATE FAILED: {failure}")
            raise SystemExit(1)
    else:
        logger.error("No backtest results generated")
        raise SystemExit(1)


if __name__ == "__main__":
    cli()
