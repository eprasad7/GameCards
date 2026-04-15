import pandas as pd

from gamecards_ml.train import assign_asof_volume_buckets


def test_assign_asof_volume_buckets_uses_trailing_90_day_history():
    rows = []
    for day in range(10):
        rows.append(
            {
                "card_id": "charizard",
                "grading_company": "PSA",
                "grade": "10",
                "sale_date": pd.Timestamp("2024-01-01") + pd.Timedelta(days=day),
                "price_usd": 100 + day,
            }
        )

    rows.append(
        {
            "card_id": "charizard",
            "grading_company": "PSA",
            "grade": "10",
            "sale_date": pd.Timestamp("2024-05-01"),
            "price_usd": 150,
        }
    )

    df = pd.DataFrame(rows)
    buckets = assign_asof_volume_buckets(df)

    assert list(buckets.iloc[:9]) == ["low"] * 9
    assert buckets.iloc[9] == "medium"
    assert buckets.iloc[10] == "low"
