# Schema for the #user collection.
from enum import Enum

from beanie import Document


class UserRole(str, Enum):
    admin = "admin"
    customer = "customer"


class User(Document):
    id: int
    mail: str
    password: str
    role: UserRole

    class Settings:
        name = "user"
