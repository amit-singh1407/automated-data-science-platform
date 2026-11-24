from __future__ import annotations

import json
from pathlib import Path
import shutil
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.core.config import settings
from app.db.database import get_db
from app.schemas import JobHistoryItem, JobResultResponse, JobStageResponse, JobStatusResponse
from app.services.file_storage import save_upload
from app.services.pipeline import process_job
from app.services.security import get_current_user

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _get_job_for_user(db: sqlite3.Connection, job_id: str, user_id: str | None = None) -> sqlite3.Row:
    if user_id:
        job = db.execute("SELECT * FROM jobs WHERE id = ? AND user_id = ?", (job_id, user_id)).fetchone()
        if job:
            return job
    job = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job


@router.post("/upload")
def upload_dataset(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    job_id = str(uuid4())
    now = datetime.now(timezone.utc)
    db.execute(
        """
        INSERT INTO jobs (
            id, user_id, original_filename, status, error_message,
            profile_json, cleaning_json, transform_json, ml_json,
            visualization_json, audit_json, progress, progress_message,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id, user["id"], file.filename or "dataset", "queued", None,
            None, None, None, None, None, None, 0, "Queued for processing",
            now.isoformat(), now.isoformat(),
        ),
    )
    db.commit()
    try:
        save_upload(file, job_id)
    except Exception:
        db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        db.commit()
        raise
    background_tasks.add_task(process_job, job_id)
    return {"job_id": job_id, "status": "queued", "message": "Processing started."}


@router.get("/{job_id}/status", response_model=JobStatusResponse)
def get_status(
    job_id: str, db: sqlite3.Connection = Depends(get_db), user: dict = Depends(get_current_user)
) -> JobStatusResponse:
    job = _get_job_for_user(db, job_id, user["id"])
    return JobStatusResponse(
        job_id=job["id"],
        status=job["status"],
        progress=job["progress"],
        progress_message=job["progress_message"],
        error_message=job["error_message"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
    )


@router.get("/{job_id}/results", response_model=JobResultResponse)
def get_results(
    job_id: str, db: sqlite3.Connection = Depends(get_db), user: dict = Depends(get_current_user)
) -> JobResultResponse:
    job = _get_job_for_user(db, job_id, user["id"])
    if job["status"] != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job status is '{job['status']}'. Results available only after completion.",
        )
    base = f"{settings.api_prefix}/jobs/{job['id']}/download"
    links = {
        "original": f"{base}/original",
        "cleaned": f"{base}/cleaned",
        "transformed": f"{base}/transformed",
        "report": f"{base}/report",
        "audit_log": f"{base}/log",
    }
    return JobResultResponse(
        job_id=job["id"],
        status=job["status"],
        profile=json.loads(job["profile_json"] or "{}"),
        cleaning=json.loads(job["cleaning_json"] or "{}"),
        transformation=json.loads(job["transform_json"] or "{}"),
        machine_learning=json.loads(job["ml_json"] or "{}"),
        visualizations=json.loads(job["visualization_json"] or "{}"),
        report_available=True,
        download_links=links,
    )


@router.get("/{job_id}/audit-logs")
def get_audit_logs(
    job_id: str, db: sqlite3.Connection = Depends(get_db), user: dict = Depends(get_current_user)
) -> dict:
    job = _get_job_for_user(db, job_id, user["id"])
    logs = json.loads(job["audit_json"] or "[]")
    return {"job_id": job["id"], "audit_logs": logs}


@router.get("/{job_id}/performance", response_model=list[JobStageResponse])
def get_performance(
    job_id: str, db: sqlite3.Connection = Depends(get_db), user: dict = Depends(get_current_user)
) -> list[JobStageResponse]:
    job = _get_job_for_user(db, job_id, user["id"])
    rows = db.execute(
        "SELECT stage, started_at, duration_ms, peak_memory_bytes, rows_processed "
        "FROM job_stages WHERE job_id = ? ORDER BY id",
        (job["id"],),
    ).fetchall()
    return [JobStageResponse(**dict(row)) for row in rows]


@router.get("/history", response_model=list[JobHistoryItem])
def list_history(db: sqlite3.Connection = Depends(get_db), user: dict = Depends(get_current_user)) -> list[JobHistoryItem]:
    rows = db.execute(
        "SELECT * FROM jobs ORDER BY created_at DESC"
    ).fetchall()
    return [
        JobHistoryItem(
            job_id=job["id"],
            filename=job["original_filename"],
            status=job["status"],
            created_at=job["created_at"],
            updated_at=job["updated_at"],
        )
        for job in rows
    ]


@router.delete("/{job_id}")
def delete_job(
    job_id: str,
    db: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    job = _get_job_for_user(db, job_id, user["id"])
    db.execute("DELETE FROM jobs WHERE id = ?", (job["id"],))
    db.execute("DELETE FROM job_stages WHERE job_id = ?", (job["id"],))
    db.execute("DELETE FROM dataset_fingerprints WHERE job_id = ?", (job["id"],))
    db.commit()
    job_dir = settings.uploads_dir / job["id"]
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    return {"status": "ok", "message": f"Job {job_id} deleted."}


@router.post("/delete-multiple")
def delete_multiple_jobs(
    payload: dict,
    db: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    job_ids = payload.get("job_ids", [])
    for jid in job_ids:
        db.execute("DELETE FROM jobs WHERE id = ?", (jid,))
        db.execute("DELETE FROM job_stages WHERE job_id = ?", (jid,))
        db.execute("DELETE FROM dataset_fingerprints WHERE job_id = ?", (jid,))
        job_dir = settings.uploads_dir / jid
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)
    db.commit()
    return {"status": "ok", "deleted_count": len(job_ids)}


@router.get("/{job_id}/download/{artifact}")
def download_artifact(
    job_id: str,
    artifact: str,
    db: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> FileResponse:
    job = _get_job_for_user(db, job_id, user["id"])
    job_dir = settings.uploads_dir / job["id"]
    if artifact == "original":
        candidates = [p for p in job_dir.iterdir() if p.name.startswith("original")]
        if not candidates:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original file not found.")
        path = candidates[0]
    elif artifact == "cleaned":
        path = _first_with_prefix(job_dir, "cleaned")
    elif artifact == "transformed":
        path = _first_with_prefix(job_dir, "transformed")
    elif artifact == "report":
        path = job_dir / "report.pdf"
    elif artifact == "log":
        path = job_dir / "audit-log.json"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported artifact.")

    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found.")
    return FileResponse(path=str(path), filename=path.name)


def _first_with_prefix(folder: Path, prefix: str) -> Path:
    for item in folder.iterdir():
        if item.name.startswith(prefix):
            return item
    return folder / f"{prefix}.missing"
