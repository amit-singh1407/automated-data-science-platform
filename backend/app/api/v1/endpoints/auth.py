from datetime import datetime, timezone
import sqlite3
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.db.database import get_db
from app.schemas import TokenResponse, UserCreate, UserLogin
from app.services.security import create_access_token, get_password_hash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(payload: UserCreate, db: sqlite3.Connection = Depends(get_db)) -> TokenResponse:
    email = payload.email.lower()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists.")
    user_id = str(uuid4())
    db.execute(
        "INSERT INTO users (id, email, hashed_password, created_at) VALUES (?, ?, ?, ?)",
        (user_id, email, get_password_hash(payload.password), datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    return TokenResponse(access_token=create_access_token(user_id))


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: sqlite3.Connection = Depends(get_db)) -> TokenResponse:
    user = db.execute(
        "SELECT id, hashed_password FROM users WHERE email = ?", (payload.email.lower(),)
    ).fetchone()
    if not user or not verify_password(payload.password, user["hashed_password"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    return TokenResponse(access_token=create_access_token(user["id"]))
