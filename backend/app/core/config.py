# Centralized app configuration, loaded from environment variables / .env.
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = "Handpikd Revmap API"
    api_v1_prefix: str = "/api/v1"
    debug: bool = True

    mongodb_uri: str
    mongodb_db_name: str = "handpikd"

    # When False, the get_current_user dependency bypasses all token checks.
    # Meant for local development/testing only.
    auth_enabled: bool = True
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # Local disk directory product images are written to, see
    # app/services/storage.py. Relative in local dev (resolves under
    # backend/), overridden to the mounted volume path in production — see
    # docker-compose.yml.
    media_root: str = "media"

    # Guards against a split-brain upload: MONGODB_URI in this project's own
    # .env points at the shared production database even during local dev,
    # so an upload run locally writes its image file under the relative
    # media_root above but records a path in the *shared* DB that only this
    # machine can serve — the live site then 404s on it. storage.py refuses
    # uploads whenever media_root is still relative (the local-dev default;
    # production always overrides it to the absolute /media mount) unless
    # this is explicitly set, so opt in only if you've also pointed
    # MONGODB_URI at a non-shared database for this session.
    allow_local_media_uploads: bool = False

    # Local disk directory uploaded vendor purchase-invoice PDFs are stored
    # to, see app/services/purchase_invoice_storage.py. Deliberately separate
    # from media_root: these are never served publicly (no StaticFiles/nginx
    # mount), since vendor documents may carry pricing/GSTIN info. Relative
    # in local dev, overridden to the mounted volume path in production —
    # see docker-compose.yml.
    purchase_invoice_root: str = "purchase_invoices"

settings = Settings()
