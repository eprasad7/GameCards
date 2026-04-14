"""
Export trained LightGBM models to ONNX format and upload to R2.

The ONNX model is loaded by the Cloudflare Worker for inference.
"""

import json
import logging
from pathlib import Path

import boto3
import click
import lightgbm as lgb
import numpy as np
from onnxmltools import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType

from .config import TrainingConfig

logger = logging.getLogger(__name__)


def export_to_onnx(model_dir: str, output_path: str, config: TrainingConfig) -> Path:
    """Convert LightGBM models to a single ONNX file."""
    model_path = Path(model_dir)
    meta_path = model_path / "model_meta.json"
    meta = json.loads(meta_path.read_text())

    num_features = len(config.feature_columns)
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # Export the median model (p50) as the primary ONNX model
    # Other quantiles are exported separately
    for q in config.quantiles:
        model_file = model_path / meta["model_files"][str(q)]
        model = lgb.Booster(model_file=str(model_file))

        initial_type = [("features", FloatTensorType([None, num_features]))]
        onnx_model = convert_lightgbm(
            model,
            initial_types=initial_type,
            target_opset=15,
        )

        q_output = output_file.parent / f"lightgbm_q{q:.2f}.onnx"
        with open(q_output, "wb") as f:
            f.write(onnx_model.SerializeToString())
        logger.info(f"Exported q={q} to {q_output} ({q_output.stat().st_size / 1024:.1f} KB)")

    # Also create a combined metadata file for the Worker
    worker_meta = {
        "version": meta["version"],
        "quantiles": config.quantiles,
        "feature_columns": config.feature_columns,
        "onnx_files": {str(q): f"lightgbm_q{q:.2f}.onnx" for q in config.quantiles},
    }
    worker_meta_path = output_file.parent / "lightgbm_quantile_latest.json"
    worker_meta_path.write_text(json.dumps(worker_meta, indent=2))

    return output_file.parent


def upload_to_r2(model_dir: Path, config: TrainingConfig):
    """Upload ONNX models to Cloudflare R2 (S3-compatible)."""
    s3 = boto3.client(
        "s3",
        endpoint_url=config.r2_endpoint,
        aws_access_key_id=config.r2_access_key,
        aws_secret_access_key=config.r2_secret_key,
        region_name="auto",
    )

    for file in model_dir.glob("*.onnx"):
        key = f"models/{file.name}"
        s3.upload_file(str(file), config.r2_bucket, key)
        logger.info(f"Uploaded {file.name} to r2://{config.r2_bucket}/{key}")

    # Upload metadata
    meta_file = model_dir / "lightgbm_quantile_latest.json"
    if meta_file.exists():
        s3.upload_file(
            str(meta_file),
            config.r2_bucket,
            "models/lightgbm_quantile_latest.json",
        )
        logger.info("Uploaded model metadata to R2")


@click.command()
@click.option("--model-dir", required=True, help="Directory with trained LightGBM models")
@click.option("--output", default="onnx_models/", help="Output directory for ONNX files")
@click.option("--upload", is_flag=True, help="Upload to R2 after export")
@click.option("--r2-endpoint", envvar="R2_ENDPOINT", help="R2 S3-compatible endpoint")
@click.option("--r2-access-key", envvar="R2_ACCESS_KEY", help="R2 access key")
@click.option("--r2-secret-key", envvar="R2_SECRET_KEY", help="R2 secret key")
def cli(
    model_dir: str,
    output: str,
    upload: bool,
    r2_endpoint: str | None,
    r2_access_key: str | None,
    r2_secret_key: str | None,
):
    """Export LightGBM models to ONNX and optionally upload to R2."""
    logging.basicConfig(level=logging.INFO)

    config = TrainingConfig()
    if r2_endpoint:
        config.r2_endpoint = r2_endpoint
    if r2_access_key:
        config.r2_access_key = r2_access_key
    if r2_secret_key:
        config.r2_secret_key = r2_secret_key

    output_dir = export_to_onnx(model_dir, output, config)
    logger.info(f"ONNX models exported to {output_dir}")

    if upload:
        if not config.r2_endpoint:
            raise click.ClickException("R2_ENDPOINT is required for upload")
        upload_to_r2(output_dir, config)
        logger.info("Upload complete")


if __name__ == "__main__":
    cli()
