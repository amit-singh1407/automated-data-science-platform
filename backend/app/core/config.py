from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "AutoData AI"
    api_prefix: str = "/api/v1"
    secret_key: str = "change-this-in-production"
    access_token_expire_minutes: int = 60 * 8
    max_upload_size_mb: int = 25
    sqlite_path: str = str(BACKEND_ROOT / "autodata.db")
    uploads_root: str = str(BACKEND_ROOT / "uploads")
    allowed_extensions: tuple[str, ...] = (".csv", ".xls", ".xlsx", ".parquet")

    model_config = SettingsConfigDict(env_file=BACKEND_ROOT / ".env", env_prefix="AUTODATA_")

    @property
    def uploads_dir(self) -> Path:
        uploads_path = Path(self.uploads_root)
        return uploads_path if uploads_path.is_absolute() else BACKEND_ROOT / uploads_path

    @property
    def database_path(self) -> Path:
        database_path = Path(self.sqlite_path)
        return database_path if database_path.is_absolute() else BACKEND_ROOT / database_path

settings = Settings()
