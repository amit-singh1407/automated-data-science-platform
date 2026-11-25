from datetime import datetime, timezone
import sqlite3
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.db.database import get_db
from app.schemas import TokenResponse, UserCreate, UserLogin, UserResponse
from app.services.security import (
    LEGACY_USER_ID,
    create_access_token,
    get_current_user,
    get_password_hash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(payload: UserCreate, db: sqlite3.Connection = Depends(get_db)) -> TokenResponse:
    email = payload.email.lower()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")
    user_id = str(uuid4())
    db.execute(
        "INSERT INTO users (id, email, hashed_password, created_at) VALUES (?, ?, ?, ?)",
        (user_id, email, get_password_hash(payload.password), datetime.now(timezone.utc).isoformat()),
    )
    # Jobs uploaded before login was required belong to a placeholder user.
    # Give them to the first real account so they are not lost.
    real_users = db.execute("SELECT COUNT(*) FROM users WHERE id != ?", (LEGACY_USER_ID,)).fetchone()[0]
    if real_users == 1:
        db.execute("UPDATE jobs SET user_id = ? WHERE user_id = ?", (user_id, LEGACY_USER_ID))
    db.commit()
    return TokenResponse(access_token=create_access_token(user_id))


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: sqlite3.Connection = Depends(get_db)) -> TokenResponse:
    user = db.execute(
        "SELECT id, hashed_password FROM users WHERE email = ? AND id != ?", (payload.email.lower(), LEGACY_USER_ID)
    ).fetchone()
    if not user or not verify_password(payload.password, user["hashed_password"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password.")
    return TokenResponse(access_token=create_access_token(user["id"]))


@router.get("/me", response_model=UserResponse)
def me(user: dict = Depends(get_current_user)) -> UserResponse:
    return UserResponse(id=user["id"], email=user["email"])
