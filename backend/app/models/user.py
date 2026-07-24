# Schema for the #user collection.
from enum import Enum

from pydantic import BaseModel


class UserRole(str, Enum):
    admin = "admin"
    customer = "customer"


class User(BaseModel):
    id: int
    mail: str
    password: str
    role: UserRole
