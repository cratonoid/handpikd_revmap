# FastAPI dependency that resolves the authenticated User from a Bearer JWT.
# Add `current_user: User | None = Depends(get_current_user)` to any route to
# require/read auth. When settings.auth_enabled is False, this bypasses the
# check entirely and resolves to None.
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.security import decode_access_token
from app.models import User

_bearer_scheme = HTTPBearer(auto_error=False)


async def _user_from_credentials(credentials: HTTPAuthorizationCredentials | None) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user = await User.get(int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User | None:
    if not settings.auth_enabled:
        return None

    return await _user_from_credentials(credentials)


async def get_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User:
    """get_current_user without the AUTH_ENABLED bypass — always a real User.

    The bypass exists so the admin screens stay usable locally without a
    login, and it works there because every admin endpoint is scoped to the
    whole business: "no user" simply means "don't check". A client-facing
    endpoint can't do that — it has to know WHICH client is asking before it
    can decide which invoices to hand back, and resolving that to None would
    either leak every client's documents or return nothing at all. So the
    /customer routes authenticate for real regardless of the setting; the
    frontend always holds a token after login (see lib/auth.ts), so this
    costs local development nothing.
    """
    return await _user_from_credentials(credentials)
