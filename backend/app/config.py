from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Values come from env vars or a root .env file."""

    model_config = SettingsConfigDict(
        env_file=[".env", "../.env"],
        env_prefix="",
        case_sensitive=True,
        extra="ignore",
    )

    ace_env: str = Field(default="development", alias="ACE_ENV")
    ace_log_level: str = Field(default="INFO", alias="ACE_LOG_LEVEL")
    ace_cors_origins: str = Field(
        default="http://localhost:5173",
        alias="ACE_CORS_ORIGINS",
        description="Comma-separated list of allowed CORS origins",
    )
    ace_model_dir: Path = Field(default=Path("app/ml/artifacts"), alias="ACE_MODEL_DIR")

    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ace_cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.ace_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
