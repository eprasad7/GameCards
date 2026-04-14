"""Training configuration."""

from dataclasses import dataclass, field


@dataclass
class TrainingConfig:
    """Configuration for the LightGBM training pipeline."""

    # Model parameters
    learning_rate: float = 0.03
    num_leaves: int = 63
    min_data_in_leaf: int = 20
    feature_fraction: float = 0.8
    bagging_fraction: float = 0.8
    bagging_freq: int = 5
    lambda_l1: float = 0.1
    lambda_l2: float = 1.0
    num_boost_round: int = 2000
    early_stopping_rounds: int = 50

    # Quantiles for prediction intervals
    quantiles: list[float] = field(
        default_factory=lambda: [0.10, 0.20, 0.25, 0.50, 0.75, 0.80, 0.90]
    )

    # Walk-forward validation
    train_months: int = 12
    test_months: int = 1
    min_train_samples: int = 1000

    # Volume bucket thresholds (sales per quarter)
    high_volume_threshold: int = 50
    medium_volume_threshold: int = 10

    # Feature columns (must match feature_store JSON keys)
    feature_columns: list[str] = field(
        default_factory=lambda: [
            "grade_numeric",
            "pop_at_grade",
            "pop_higher",
            "pop_ratio",
            "sales_count_7d",
            "sales_count_30d",
            "sales_count_90d",
            "velocity_trend",
            "price_momentum",
            "avg_price_7d",
            "avg_price_30d",
            "avg_price_90d",
            "price_volatility_30d",
            "social_sentiment_score",
            "social_mention_count_7d",
            "month_sin",
            "month_cos",
            "is_gem_mint",
            "is_perfect_10",
            "is_pop_1",
            "is_holiday_season",
            "is_tax_refund_season",
        ]
    )

    # R2 upload
    r2_endpoint: str = ""
    r2_access_key: str = ""
    r2_secret_key: str = ""
    r2_bucket: str = "gamecards-models"

    # MLflow
    mlflow_tracking_uri: str = "mlruns"
    experiment_name: str = "gamecards-pricing"
