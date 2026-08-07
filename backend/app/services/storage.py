# Uploads product images to Cloudflare R2 (S3-compatible object storage) and
# returns their public CDN URL, to be stored as ProductImageDetails.image_path
# (see routes/products.py's upload_product_image).
import uuid
from functools import lru_cache

import boto3

from app.core.config import settings


# Built lazily (not at import time) so the app can still start up — and other
# routes/tests keep working — before R2 credentials are filled into .env;
# only an actual upload attempt fails until then. Cached since building an
# S3 client is not free and settings don't change at runtime.
@lru_cache
def _get_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def upload_product_image(image_bytes: bytes, filename: str, content_type: str | None) -> str:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    key = f"product-images/{uuid.uuid4().hex}.{extension}"

    _get_client().put_object(
        Bucket=settings.r2_bucket_name,
        Key=key,
        Body=image_bytes,
        ContentType=content_type or "application/octet-stream",
    )

    return f"{settings.r2_public_base_url.rstrip('/')}/{key}"
