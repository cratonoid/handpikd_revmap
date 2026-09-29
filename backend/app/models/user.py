# Schema for the #user collection.
from datetime import datetime
from enum import Enum

from beanie import Document


class UserRole(str, Enum):
    # The kind of account, not its permissions. "admin" is any team member
    # who signs in to /admin — what they can open there is decided by their
    # role_id (see app/models/role.py). "customer" is a client's login to
    # the /customer portal, created alongside the client on /admin/clients.
    # The value stays "admin" because it is stored on every existing user.
    admin = "admin"
    customer = "customer"


class User(Document):
    id: int
    mail: str
    password: str
    role: UserRole
    # Team accounts only: the Role that decides which admin sections they
    # can open. None on client logins. Existing admins are backfilled onto
    # the system role by _backfill_admin_role_ids in app/core/db.py.
    role_id: int | None = None
    # Display name for team accounts on /admin/users. Client logins leave it
    # blank — their name lives on CustomerDetails.
    name: str = ""
    # A disabled account can't sign in, and any token it still holds stops
    # working (see _user_from_credentials in app/api/deps.py).
    is_active: bool = True
    last_login: datetime | None = None

    class Settings:
        name = "user"
