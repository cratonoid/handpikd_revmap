# Request/response bodies for the Users & Roles module (routes/users.py):
# team accounts that sign in to /admin, and the roles that decide which
# admin sections each of them can open.
from datetime import datetime

from pydantic import BaseModel

from app.models import Section


class RoleItem(BaseModel):
    role_id: int
    name: str
    # Empty on the system role, which grants every section implicitly —
    # is_system is what the UI should read, not this list.
    sections: list[Section]
    is_system: bool
    user_count: int


class AddRoleRequest(BaseModel):
    name: str
    sections: list[Section]


class UpdateRoleRequest(BaseModel):
    role_id: int
    name: str
    sections: list[Section]


class DeleteRoleRequest(BaseModel):
    role_id: int


class TeamUserItem(BaseModel):
    user_id: int
    name: str
    mail: str
    # Parallel lists, in role id order; a role that no longer exists is left
    # out of both.
    role_ids: list[int]
    role_names: list[str]
    is_active: bool
    last_login: datetime | None


class AddTeamUserRequest(BaseModel):
    name: str
    mail: str
    password: str
    # At least one.
    role_ids: list[int]
    is_active: bool = True


class UpdateTeamUserRequest(BaseModel):
    user_id: int
    name: str
    mail: str
    # Empty string means "leave the current password unchanged", same as
    # update_customer_details.
    password: str = ""
    role_ids: list[int]
    is_active: bool = True


class DeleteTeamUserRequest(BaseModel):
    user_id: int


class MessageResponse(BaseModel):
    message: str


class MyAccessResponse(BaseModel):
    user_id: int
    name: str
    mail: str
    # Every role's name, comma-separated, for the sidebar.
    role_name: str
    # None means every section (the system role); otherwise exactly the
    # sections the admin sidebar should show.
    sections: list[Section] | None


class ClientLoginItem(BaseModel):
    # A client's portal login (UserRole.customer), listed read-only beside
    # the team on /admin/users. Everything but is_active is edited with the
    # client on /admin/clients.
    user_id: int
    mail: str
    registered_name: str
    company_or_department: str
    is_active: bool
    # A soft-deleted client can't use the portal whatever is_active says
    # (require_customer_account in routes/customer_invoices.py).
    client_deleted: bool
    last_login: datetime | None


class SetClientLoginActiveRequest(BaseModel):
    user_id: int
    is_active: bool
