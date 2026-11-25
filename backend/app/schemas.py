from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(UserCreate):
    pass


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str


class DeleteJobsRequest(BaseModel):
    job_ids: list[str] = Field(min_length=1, max_length=500)


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    progress_message: str | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class JobResultResponse(BaseModel):
    job_id: str
    status: str
    profile: dict[str, Any] | None
    cleaning: dict[str, Any] | None
    transformation: dict[str, Any] | None
    machine_learning: dict[str, Any] | None
    visualizations: dict[str, Any] | None
    report_available: bool
    download_links: dict[str, str]


class JobHistoryItem(BaseModel):
    job_id: str
    filename: str
    status: str
    created_at: datetime
    updated_at: datetime
    progress: int = 0
    error_message: str | None = None
    rows: int | None = None
    quality_before: float | None = None
    quality_after: float | None = None
    duration_ms: float | None = None


class JobStageResponse(BaseModel):
    stage: str
    started_at: datetime
    duration_ms: float
    peak_memory_bytes: int
    rows_processed: int
