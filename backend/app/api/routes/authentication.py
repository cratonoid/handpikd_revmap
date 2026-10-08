# Authentication module: credential check + JWT issuance.
# login_auth returns a success message and access token on match, or 403/401
# with a reason on failure. On success, the user's last_login is updated.
# get_my_access tells the admin sidebar which sections to show.
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_allowed_sections, get_authenticated_user
from app.core.security import create_access_token, verify_password
from app.models import Role, Section, User, UserRole
from app.schemas.authentication import LoginAuthRequest, LoginAuthResponse
from app.schemas.users import MyAccessResponse

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

    # Only reached with the right password, so saying why doesn't reveal
    # anything a wrong guess could learn.
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account disabled")

    user.last_login = datetime.now(IST).replace(tzinfo=None)
    await user.save()

    token = create_access_token(user_id=user.id, role=user.role.value)
    return LoginAuthResponse(message="authentication successful", access_token=token, role=user.role.value)


@router.get("/get_my_access", response_model=MyAccessResponse)
async def get_my_access(current_user: User = Depends(get_authenticated_user)) -> MyAccessResponse:
    # Read on every admin page load rather than stored at login, so a role
    # change applies the next time the user navigates instead of the next
    # time they sign in. Always authenticates for real (not get_current_user)
    # since the answer depends on who is asking.
    if current_user.role != UserRole.admin:
        return MyAccessResponse(
            user_id=current_user.id, name=current_user.name, mail=current_user.mail, role_name="Customer", sections=[]
        )

    roles = [role for role_id in current_user.role_ids if (role := await Role.get(role_id)) is not None]
    allowed = await get_allowed_sections(current_user)
    return MyAccessResponse(
        user_id=current_user.id,
        name=current_user.name,
        mail=current_user.mail,
        role_name=", ".join(role.name for role in roles),
        sections=None if allowed is None else [section for section in Section if section in allowed],
    )
