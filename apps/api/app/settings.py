from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ai-seller-ecosystem-api"
    app_version: str = "0.1.0"
    app_env: str = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://app:change-me@localhost:5432/ai_seller"
    redis_url: str = "redis://localhost:6379/0"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
