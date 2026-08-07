# Authentication module: credential check + JWT issuance.
# login_auth returns a success message and access token on match, or 403/401
# with a reason on failure. On success, the user's last_login is updated.
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status

from app.core.security import create_access_token, verify_password
from app.models import User
from app.schemas.authentication import LoginAuthRequest, LoginAuthResponse

router = APIRouter(prefix="/authentication", tags=["authentication"])

# IST has a fixed +5:30 offset (no DST), so a plain offset is enough — no
# tzdata package needed. Stripped to naive before saving so MongoDB stores
# the IST wall-clock value as-is instead of normalizing it to UTC.
IST = timezone(timedelta(hours=5, minutes=30))


@router.post("/login_auth", response_model=LoginAuthResponse)
async def login_auth(payload: LoginAuthRequest) -> LoginAuthResponse:
    user = await User.find_one(User.mail == payload.email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid user")

    if not verify_password(payload.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="password missmatch")

    user.last_login = datetime.now(IST).replace(tzinfo=None)
    await user.save()

    token = create_access_token(user_id=user.id, role=user.role.value)
    return LoginAuthResponse(message="authentication successful", access_token=token, role=user.role.value)
