# FastAPI dependency that resolves the authenticated User from a Bearer JWT.
# Add `current_user: User | None = Depends(get_current_user)` to any route to
# require/read auth. When settings.auth_enabled is False, this bypasses the
# check entirely and resolves to None.
#
# Admin endpoints depend on require_staff (any team account) or
# require_section(...) (a team account whose role grants that section) —
# see app/models/role.py for how roles and sections fit together.
from collections.abc import Awaitable, Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.security import decode_access_token
from app.models import Role, Section, User, UserRole

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

    # 401 rather than 403 so the frontend's apiFetch drops the session and
    # sends a disabled user back to the login page instead of leaving them on
    # a page where every request fails.
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="account disabled")

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


async def get_allowed_sections(user: User) -> set[Section] | None:
    """The admin sections a team account may open; None means all of them.

    A user with several roles gets every section any of them grants, and
    all of them if one is the system role. A missing role (never assigned,
    or pointing at a deleted one) grants nothing rather than everything, so
    a mistake fails closed.
    """
    allowed: set[Section] = set()
    for role_id in user.role_ids:
        role = await Role.get(role_id)
        if role is None:
            continue
        if role.is_system:
            return None
        allowed.update(role.sections)
    return allowed


async def require_staff(current_user: User | None = Depends(get_current_user)) -> User | None:
    """Any team account, whatever its role.

    Used on the read endpoints several sections share — the customer,
    product and vendor lookups every order and invoice form needs — so
    granting a role "Orders" doesn't also require granting it "Clients".
    Anything that changes data, or reads data only one section shows, uses
    require_section instead.
    """
    if current_user is not None and current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin access required")
    return current_user


def require_section(*sections: Section) -> Callable[..., Awaitable[User | None]]:
    """A team account whose role grants at least one of `sections`.

    Several sections are accepted where one screen writes another's data —
    the Orders page attaching a purchase-invoice PDF, for instance.
    """

    async def dependency(current_user: User | None = Depends(require_staff)) -> User | None:
        if current_user is None:
            return None
        allowed = await get_allowed_sections(current_user)
        if allowed is not None and allowed.isdisjoint(sections):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="you don't have access to this section")
        return current_user

    return dependency
