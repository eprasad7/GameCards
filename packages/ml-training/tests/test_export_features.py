from gamecards_ml.export_features import TRAINING_MIN_PRICE_USD, training_export_sql


def test_training_export_sql_uses_point_in_time_history():
    sql = training_export_sql()

    assert "feature_store_history" in sql
    assert "MAX(snapshot_date)" in sql
    assert "snapshot_date <= date(po.sale_date)" in sql
    assert "INNER JOIN feature_store_history" in sql
    assert f"po.price_usd >= {TRAINING_MIN_PRICE_USD}" in sql
