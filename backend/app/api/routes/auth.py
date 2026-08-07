# Auth endpoints: /login issues a JWT, /me is a protected demo route that
# proves the get_current_user dependency (and its AUTH_ENABLED bypass) works.
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.models import User
from app.schemas.auth import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest) -> TokenResponse:
    user = await User.find_one(User.mail == payload.mail)
    if user is None or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(user_id=user.id, role=user.role.value)
    return TokenResponse(access_token=token)


@router.get("/me")
async def read_current_user(current_user: User | None = Depends(get_current_user)):
    if current_user is None:
        return {"authenticated": False}
    return {"authenticated": True, "id": current_user.id, "mail": current_user.mail, "role": current_user.role}
