# Password hashing and JWT access-token creation/decoding.
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(user_id: int, role: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_expire_minutes)
    # `iat` lets a restore end every session that predates it (see
    # services/restore_epoch.py): user ids come back from the backup, so an
    # older token's `sub` may now name somebody else.
    payload = {"sub": str(user_id), "role": role, "iat": now, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


# A narrow, short-lived token for one thing only — today, downloading one
# named backup file (routes/backups.py). It travels in a URL, so the browser
# can stream a multi-GB file straight to disk instead of via fetch(); the
# `purpose` claim is what stops _user_from_credentials in api/deps.py from
# ever accepting it as a login.
def create_purpose_token(user_id: int | None, purpose: str, subject: str, minutes: int = 5) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"uid": user_id, "purpose": purpose, "subject": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_purpose_token(token: str, purpose: str) -> dict:
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("purpose") != purpose:
        raise jwt.InvalidTokenError("wrong token purpose")
    return payload


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
