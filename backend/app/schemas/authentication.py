# Request/response bodies for the authentication module's login_auth endpoint.
from pydantic import BaseModel


class LoginAuthRequest(BaseModel):
    email: str
    password: str


class LoginAuthResponse(BaseModel):
    message: str
    access_token: str
    token_type: str = "bearer"
    role: str
