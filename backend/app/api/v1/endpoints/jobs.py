from __future__ import annotations

import json
from pathlib import Path
import shutil
import sqlite3
import zipfile
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.core.config import settings
from app.db.database import get_db
from app.schemas import DeleteJobsRequest, JobHistoryItem, JobResultResponse, JobStageResponse, JobStatusResponse
from app.services.ecp import SIDE_TABLES
from app.services.file_storage import save_upload
from app.services.pipeline import process_job
from app.services.security import get_current_user

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _get_job_for_user(db: sqlite3.Connection, job_id: str, user_id: str) -> sqlite3.Row:
    """A job owned by this user. Another user's job gives the same 404 as a
    missing one, so job IDs of other users cannot be discovered."""
    job = db.execute("SELECT * FROM jobs WHERE id = ? AND user_id = ?", (job_id, user_id)).fetchone()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job


def _delete_job_files(db: sqlite3.Connection, job_id: str) -> None:
    db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    db.execute("DELETE FROM job_stages WHERE job_id = ?", (job_id,))
    db.execute("DELETE FROM dataset_fingerprints WHERE job_id = ?", (job_id,))
    job_dir = settings.uploads_dir / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)


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
    job_dir = settings.uploads_dir / job["id"]
    for artifact in ("review", *SIDE_TABLES):
        if _artifact_path(job_dir, artifact).exists():
            links[artifact] = f"{base}/{artifact}"
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
        """
        SELECT j.id, j.original_filename, j.status, j.created_at, j.updated_at,
               j.progress, j.error_message,
               json_extract(j.profile_json, '$.rows') AS rows_in,
               json_extract(j.profile_json, '$.quality_score') AS quality_before,
               json_extract(j.cleaning_json, '$.before_after_quality.after') AS quality_after,
               (SELECT SUM(s.duration_ms) FROM job_stages s WHERE s.job_id = j.id) AS duration_ms
        FROM jobs j
        WHERE j.user_id = ?
        ORDER BY j.created_at DESC
        """,
        (user["id"],),
    ).fetchall()
    return [
        JobHistoryItem(
            job_id=job["id"],
            filename=job["original_filename"],
            status=job["status"],
            created_at=job["created_at"],
            updated_at=job["updated_at"],
            progress=job["progress"] or 0,
            error_message=job["error_message"],
            rows=job["rows_in"],
            quality_before=job["quality_before"],
            quality_after=job["quality_after"],
            duration_ms=job["duration_ms"],
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
    _delete_job_files(db, job["id"])
    db.commit()
    return {"status": "ok", "message": f"Job {job_id} deleted."}


@router.post("/delete-multiple")
def delete_multiple_jobs(
    payload: DeleteJobsRequest,
    db: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Delete several of the user's own jobs. IDs of other users' jobs (or
    unknown IDs) are ignored, never deleted."""
    marks = ",".join("?" * len(payload.job_ids))
    owned = [
        row["id"] for row in db.execute(
            f"SELECT id FROM jobs WHERE user_id = ? AND id IN ({marks})", (user["id"], *payload.job_ids)
        ).fetchall()
    ]
    for job_id in owned:
        _delete_job_files(db, job_id)
    db.commit()
    return {"status": "ok", "deleted_count": len(owned)}


@router.get("/{job_id}/download/{artifact}")
def download_artifact(
    job_id: str,
    artifact: str,
    db: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> FileResponse:
    job = _get_job_for_user(db, job_id, user["id"])
    if artifact not in ARTIFACTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported artifact.")
    job_dir = settings.uploads_dir / job["id"]
    if artifact == "all":
        if job["status"] != "completed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not completed yet.")
        _build_bundle(job_dir)
    path = _artifact_path(job_dir, artifact)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found.")
    return FileResponse(path=str(path), filename=path.name)


ARTIFACTS = ("original", "cleaned", "transformed", "report", "log", "review", *SIDE_TABLES, "all")
BUNDLE_NAME = "autodata-all-files.zip"


def _build_bundle(job_dir: Path) -> None:
    """Zip every artifact of the job once; later requests reuse the file."""
    bundle = job_dir / BUNDLE_NAME
    if bundle.exists():
        return
    partial = job_dir / (BUNDLE_NAME + ".part")
    with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in sorted(job_dir.iterdir()):
            if item.is_file() and not item.name.startswith(BUNDLE_NAME):
                archive.write(item, arcname=item.name)
    partial.replace(bundle)


def _artifact_path(job_dir: Path, artifact: str) -> Path:
    if artifact == "all":
        return job_dir / BUNDLE_NAME
    if artifact in ("original", "cleaned", "transformed"):
        return _first_with_prefix(job_dir, artifact)
    if artifact == "report":
        return job_dir / "report.pdf"
    if artifact == "log":
        # audit-log.json is the format used by jobs processed before ECP.
        csv_log = job_dir / "audit-log.csv"
        return csv_log if csv_log.exists() else job_dir / "audit-log.json"
    if artifact == "review":
        return job_dir / "review.csv"
    return job_dir / f"side-{artifact}.csv"


def _first_with_prefix(folder: Path, prefix: str) -> Path:
    if folder.is_dir():
        for item in folder.iterdir():
            if item.name.startswith(prefix):
                return item
    return folder / f"{prefix}.missing"
