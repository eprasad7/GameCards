from gamecards_ml.backtest import summarize_backtest, validate_backtest_summary


def test_summarize_backtest_aggregates_fold_metrics():
    summary = summarize_backtest(
        [
            {"mdape": 10.0, "coverage_p10_p90": 80.0, "simulated_pnl": 5.0},
            {"mdape": 20.0, "coverage_p10_p90": 70.0, "simulated_pnl": -1.5},
        ]
    )

    assert summary["folds"] == 2
    assert summary["avg_mdape"] == 15.0
    assert summary["avg_coverage_p10_p90"] == 75.0
    assert summary["total_simulated_pnl"] == 3.5


def test_validate_backtest_summary_enforces_thresholds():
    summary = {
        "folds": 2,
        "avg_mdape": 15.0,
        "avg_coverage_p10_p90": 75.0,
    }

    assert validate_backtest_summary(
        summary,
        max_mdape=20.0,
        min_coverage_p10_p90=70.0,
        min_folds=1,
    ) == []

    failures = validate_backtest_summary(
        summary,
        max_mdape=10.0,
        min_coverage_p10_p90=80.0,
        min_folds=3,
    )

    assert "fold count 2 below minimum 3" in failures
    assert "avg_mdape 15.00 exceeds maximum 10.00" in failures
    assert "avg_coverage_p10_p90 75.00 below minimum 80.00" in failures
