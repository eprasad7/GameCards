"""
Export features and training data from Cloudflare D1 via the HTTP API.

D1 exposes a REST API that can be called with an API token.
This script queries the feature_store and price_observations tables
and writes CSVs for training and batch scoring.

Usage:
    gamecards-export-features \
      --account-id YOUR_CF_ACCOUNT_ID \
      --database-id YOUR_D1_DATABASE_ID \
      --api-token YOUR_CF_API_TOKEN \
      --output-features features.csv \
      --output-training training_data.csv
"""

import csv
import json
import logging
from pathlib import Path

import click
import requests

logger = logging.getLogger(__name__)

D1_API_BASE = "https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
TRAINING_MIN_PRICE_USD = 10.0


def query_d1(account_id: str, database_id: str, api_token: str, sql: str, params: list | None = None) -> list[dict]:
    """Execute a SQL query against D1 via the Cloudflare API."""
    url = D1_API_BASE.format(account_id=account_id, database_id=database_id)
    payload = {"sql": sql}
    if params:
        payload["params"] = params

    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    resp.raise_for_status()
    data = resp.json()

    if not data.get("success"):
        errors = data.get("errors", [])
        raise RuntimeError(f"D1 query failed: {errors}")

    results = data.get("result", [])
    if results and results[0].get("results"):
        return results[0]["results"]
    return []


def export_features(account_id: str, database_id: str, api_token: str, output_path: str) -> int:
    """Export feature_store to CSV for batch scoring."""
    rows = query_d1(
        account_id, database_id, api_token,
        "SELECT card_id, grade, grading_company, features FROM feature_store"
    )

    if not rows:
        logger.warning("No feature rows found in D1")
        return 0

    # Parse the JSON features column and flatten
    flat_rows = []
    for row in rows:
        features = json.loads(row["features"]) if isinstance(row["features"], str) else row["features"]
        flat = {
            "card_id": row["card_id"],
            "grade": row["grade"],
            "grading_company": row["grading_company"],
            **features,
        }
        flat_rows.append(flat)

    # Write CSV
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(flat_rows[0].keys())

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(flat_rows)

    logger.info(f"Exported {len(flat_rows)} feature rows to {path}")
    return len(flat_rows)


def training_export_sql(min_price_usd: float = TRAINING_MIN_PRICE_USD) -> str:
    """SQL for point-in-time training export."""
    return f"""SELECT po.card_id, po.grade, po.grading_company, po.price_usd, po.sale_date,
                  fsh.features
           FROM price_observations po
           INNER JOIN feature_store_history fsh
             ON fsh.card_id = po.card_id
             AND fsh.grade = COALESCE(po.grade, 'RAW')
             AND fsh.grading_company = COALESCE(po.grading_company, 'RAW')
             AND fsh.snapshot_date = (
               SELECT MAX(snapshot_date)
               FROM feature_store_history fsh2
               WHERE fsh2.card_id = po.card_id
                 AND fsh2.grade = COALESCE(po.grade, 'RAW')
                 AND fsh2.grading_company = COALESCE(po.grading_company, 'RAW')
                 AND fsh2.snapshot_date <= date(po.sale_date)
             )
           WHERE po.is_anomaly = 0
             AND po.grade IS NOT NULL
             AND po.price_usd >= {min_price_usd}
           ORDER BY po.sale_date"""


def export_training_data(account_id: str, database_id: str, api_token: str, output_path: str) -> int:
    """Export price_observations joined with features for model training.

    Exports only rows that have a feature snapshot on or before the sale date.
    This keeps the training set point-in-time correct at the cost of dropping
    rows that predate the snapshot history.
    """
    rows = query_d1(
        account_id, database_id, api_token,
        training_export_sql()
    )

    if not rows:
        logger.warning("No training rows found in D1")
        return 0

    flat_rows = []
    for row in rows:
        features = {}
        if row.get("features"):
            features = json.loads(row["features"]) if isinstance(row["features"], str) else row["features"]
        flat = {
            "card_id": row["card_id"],
            "grade": row["grade"],
            "grading_company": row["grading_company"],
            "price_usd": row["price_usd"],
            "sale_date": row["sale_date"],
            **features,
        }
        flat_rows.append(flat)

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(flat_rows[0].keys())

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(flat_rows)

    logger.info(f"Exported {len(flat_rows)} training rows to {path}")
    return len(flat_rows)


@click.command()
@click.option("--account-id", required=True, envvar="CF_ACCOUNT_ID", help="Cloudflare account ID")
@click.option("--database-id", required=True, envvar="CF_D1_DATABASE_ID", help="D1 database ID")
@click.option("--api-token", required=True, envvar="CF_API_TOKEN", help="Cloudflare API token")
@click.option("--output-features", default="features.csv", help="Output path for features CSV")
@click.option("--output-training", default="training_data.csv", help="Output path for training data CSV")
def cli(account_id: str, database_id: str, api_token: str, output_features: str, output_training: str):
    """Export features and training data from Cloudflare D1."""
    logging.basicConfig(level=logging.INFO)

    feat_count = export_features(account_id, database_id, api_token, output_features)
    train_count = export_training_data(account_id, database_id, api_token, output_training)

    logger.info(f"Export complete: {feat_count} features, {train_count} training rows")


if __name__ == "__main__":
    cli()
