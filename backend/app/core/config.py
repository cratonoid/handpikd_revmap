from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = "Handpikd Revmap API"
    api_v1_prefix: str = "/api/v1"
    debug: bool = True

    mongodb_uri: str
    mongodb_db_name: str = "handpikd"


settings = Settings()
