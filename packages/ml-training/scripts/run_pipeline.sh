#!/usr/bin/env bash
set -euo pipefail

# Full training → scoring → upload pipeline.
# Run weekly (or on-demand) to retrain models and update predictions.
#
# Prerequisites:
#   pip install -e packages/ml-training
#   Export R2 credentials: R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY
#
# Usage:
#   ./scripts/run_pipeline.sh <training_data.csv> <features.csv>

usage() {
  echo "Usage: $0 <training_data.csv> <features.csv>"
  echo ""
  echo "Arguments:"
  echo "  training_data.csv  CSV with card_id, grade, grading_company, sale_date, price_usd, + feature columns"
  echo "  features.csv       CSV with card_id, grade, grading_company, + feature columns (for scoring all cards)"
  exit 1
}

if [ $# -lt 2 ]; then
  usage
fi

DATA_FILE="$1"
FEATURES_FILE="$2"

if [ ! -f "$DATA_FILE" ]; then
  echo "Error: training data file not found: $DATA_FILE"
  exit 1
fi
if [ ! -f "$FEATURES_FILE" ]; then
  echo "Error: features file not found: $FEATURES_FILE"
  exit 1
fi

MODEL_DIR="models/"
ONNX_DIR="onnx_models/"
OUTPUT="batch_predictions.json"

echo "=== Step 1: Train quantile models ==="
gamecards-train --data "$DATA_FILE" --output "$MODEL_DIR"

# Quality gate: check MdAPE from MLflow metrics
# train.py logs mdape_overall to mlruns/. If we had a metrics file, we could gate here.
# For now, the train script exits non-zero on failure.

echo ""
echo "=== Step 2: Export to ONNX ==="
gamecards-export --model-dir "$MODEL_DIR" --output "$ONNX_DIR"

echo ""
echo "=== Step 3: Batch score all cards ==="
# Conformal correction is auto-loaded from model_meta.json
gamecards-score \
  --model-dir "$MODEL_DIR" \
  --features "$FEATURES_FILE" \
  --output "$OUTPUT" \
  --upload

echo ""
echo "=== Pipeline complete ==="
echo "Predictions uploaded to R2. The Worker will pick them up within 10 minutes."
