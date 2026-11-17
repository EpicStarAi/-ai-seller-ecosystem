from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ai-seller-ecosystem-api"
    app_version: str = "0.1.0"
    app_env: str = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://app_runtime:change-me-local-only@localhost:5432/ai_seller"
    redis_url: str = "redis://localhost:6379/0"
    auth_jwks_url: str = ""
    auth_issuer: str = ""
    auth_audience: str = ""
    anthropic_api_key: str = ""
    claude_default_model: str = "claude-sonnet-5-5"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
