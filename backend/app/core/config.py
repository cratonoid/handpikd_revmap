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


settings = Settings()
