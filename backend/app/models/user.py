# Schema for the #user collection.
from datetime import datetime
from enum import Enum

from beanie import Document


class UserRole(str, Enum):
    # The kind of account, not its permissions. "admin" is any team member
    # who signs in to /admin — what they can open there is decided by their
    # role_ids (see app/models/role.py). "customer" is a client's login to
    # the /customer portal, created alongside the client on /admin/clients.
    # The value stays "admin" because it is stored on every existing user.
    admin = "admin"
    customer = "customer"


class User(Document):
    id: int
    mail: str
    password: str
    role: UserRole
    # Team accounts only: the Roles that decide which admin sections they
    # can open — they get every section any of them grants. Empty on client
    # logins. Accounts from before multiple roles (a single role_id) are
    # moved onto this, and admins with no role at all onto the system role,
    # by _backfill_admin_role_ids in app/core/db.py.
    role_ids: list[int] = []
    # Display name for team accounts on /admin/users. Client logins leave it
    # blank — their name lives on CustomerDetails.
    name: str = ""
    # A disabled account can't sign in, and any token it still holds stops
    # working (see _user_from_credentials in app/api/deps.py).
    is_active: bool = True
    last_login: datetime | None = None

    class Settings:
        name = "user"
