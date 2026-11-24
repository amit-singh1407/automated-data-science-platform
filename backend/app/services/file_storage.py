from pathlib import Path

import pandas as pd
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings


def ensure_job_dir(job_id: str) -> Path:
    job_dir = settings.uploads_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def validate_upload(file: UploadFile) -> str:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing filename.")
    extension = Path(file.filename).suffix.lower()
    if extension not in settings.allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file extension: {extension}.",
        )
    return extension


def save_upload(file: UploadFile, job_id: str) -> Path:
    extension = validate_upload(file)
    job_dir = ensure_job_dir(job_id)
    target_path = job_dir / f"original{extension}"
    content = file.file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.max_upload_size_mb}MB upload limit.",
        )
    target_path.write_bytes(content)
    return target_path


def load_dataframe(path: Path) -> pd.DataFrame:
    extension = path.suffix.lower()
    if extension == ".csv":
        return pd.read_csv(path)
    if extension == ".xls":
        return pd.read_excel(path, engine="xlrd")
    if extension == ".xlsx":
        return pd.read_excel(path, engine="openpyxl")
    if extension == ".parquet":
        return pd.read_parquet(path)
    raise ValueError(f"Unsupported file extension: {extension}")


def save_dataframe(df: pd.DataFrame, path: Path) -> None:
    extension = path.suffix.lower()
    if extension == ".csv":
        df.to_csv(path, index=False)
    elif extension == ".xls":
        raise ValueError("Cleaned .xls output is not supported. Please upload .xlsx or CSV.")
    elif extension == ".xlsx":
        df.to_excel(path, index=False, engine="openpyxl")
    elif extension == ".parquet":
        df.to_parquet(path, index=False)
    else:
        raise ValueError(f"Unsupported output extension: {extension}")
