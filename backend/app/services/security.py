from datetime import datetime, timedelta, timezone
import sqlite3

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from app.core.config import settings
from app.db.database import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_prefix}/auth/login", auto_error=False)

# Jobs created before login was required belong to this placeholder user.
# The first account that registers takes them over (see auth.register).
LEGACY_USER_ID = "default-user"


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except ValueError:
        return False  # e.g. the legacy placeholder user, which has no real hash


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    token: str | None = Depends(oauth2_scheme), db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """The logged-in user. Every jobs endpoint requires a valid bearer token."""
    if not token:
        raise _unauthorized("Please log in.")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except JWTError:
        raise _unauthorized("Your session has expired or is invalid. Please log in again.")
    user_id = payload.get("sub")
    user = db.execute("SELECT id, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone() if user_id else None
    if not user or user["id"] == LEGACY_USER_ID:
        raise _unauthorized("Your account was not found. Please log in again.")
    return dict(user)
