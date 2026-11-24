from datetime import datetime, timedelta, timezone

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import bcrypt
import sqlite3

from app.core.config import settings
from app.db.database import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_prefix}/auth/login", auto_error=False)

DEFAULT_USER_ID = "default-user"

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def ensure_default_user(db: sqlite3.Connection) -> dict:
    user = db.execute("SELECT id, email, created_at FROM users WHERE id = ?", (DEFAULT_USER_ID,)).fetchone()
    if not user:
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "INSERT OR IGNORE INTO users (id, email, hashed_password, created_at) VALUES (?, ?, ?, ?)",
            (DEFAULT_USER_ID, "user@autodata.ai", "nopassword", now),
        )
        db.commit()
        user = db.execute("SELECT id, email, created_at FROM users WHERE id = ?", (DEFAULT_USER_ID,)).fetchone()
    return dict(user) if user else {"id": DEFAULT_USER_ID, "email": "user@autodata.ai", "created_at": datetime.now(timezone.utc).isoformat()}


def get_current_user(
    token: str | None = Depends(oauth2_scheme), db: sqlite3.Connection = Depends(get_db)
) -> dict:
    if not token:
        return ensure_default_user(db)
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = payload.get("sub")
        if user_id:
            user = db.execute("SELECT id, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
            if user:
                return dict(user)
    except JWTError:
        pass
    except Exception:
        pass
    return ensure_default_user(db)
