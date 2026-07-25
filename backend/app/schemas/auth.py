# Request/response bodies for the auth endpoints.
from pydantic import BaseModel


class LoginRequest(BaseModel):
    mail: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
