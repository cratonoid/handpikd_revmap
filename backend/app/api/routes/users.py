# Users & Roles module (/admin/users): team accounts that sign in to /admin,
# and the roles that decide which admin sections each of them can open.
# Client logins (UserRole.customer) are listed read-only in their own tab:
# the only thing changed from here is whether the login is enabled. They are
# created and otherwise edited with their client on /admin/clients, and
# never get a role — roles are for the admin panel, not the client portal.
#
# Every endpoint needs Section.users. The system role (SYSTEM_ROLE_ID) can't
# be edited or deleted, and every change is checked against
# _ensure_an_administrator_remains, so this page can never lock out the last
# person able to reach it.
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.core.security import hash_password
from app.models import (
    SYSTEM_ROLE_ID,
    CustomerDetails,
    Role,
    RoleIdCounter,
    Section,
    User,
    UserIdCounter,
    UserRole,
)
from app.schemas.users import (
    AddRoleRequest,
    AddTeamUserRequest,
    ClientLoginItem,
    DeleteRoleRequest,
    DeleteTeamUserRequest,
    MessageResponse,
    RoleItem,
    SetClientLoginActiveRequest,
    TeamUserItem,
    UpdateRoleRequest,
    UpdateTeamUserRequest,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/users", tags=["users"])

MIN_PASSWORD_LENGTH = 8


def _clean_role_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role name is required")
    return cleaned


def _unique_sections(sections: list[Section]) -> list[Section]:
    # Kept in Section's declaration order, so a role reads the same way as
    # the sidebar no matter what order its boxes were ticked in.
    chosen = set(sections)
    return [section for section in Section if section in chosen]


async def _ensure_role_name_free(name: str, excluding_role_id: int | None = None) -> None:
    roles = await Role.find_all().to_list()
    if any(role.name.casefold() == name.casefold() and role.id != excluding_role_id for role in roles):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="a role with this name already exists")


async def _get_role_or_404(role_id: int) -> Role:
    role = await Role.get(role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")
    return role


async def _clean_role_ids(role_ids: list[int]) -> list[int]:
    # Deduped and kept in role id order, so a user's roles always list the
    # same way. Every one must exist — a stale id would silently grant
    # nothing (see get_allowed_sections).
    cleaned = sorted(set(role_ids))
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="pick at least one role")
    for role_id in cleaned:
        await _get_role_or_404(role_id)
    return cleaned


async def _get_team_user_or_404(user_id: int) -> User:
    user = await User.get(user_id)
    if user is None or user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    return user


def _clean_mail(mail: str) -> str:
    cleaned = mail.strip()
    if not cleaned or "@" not in cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="a valid email is required")
    return cleaned


def _check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )


async def _ensure_mail_free(mail: str, excluding_user_id: int | None = None) -> None:
    # Checked against every login, client portal accounts included — mail is
    # what login_auth looks a user up by, so two accounts can't share one.
    clash = await User.find_one(User.mail == mail)
    if clash is not None and clash.id != excluding_user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")


def _is_active_administrator(user: User) -> bool:
    return user.role == UserRole.admin and user.is_active and SYSTEM_ROLE_ID in user.role_ids


async def _ensure_an_administrator_remains(changing: User) -> None:
    """Refuse a change that would leave no active user on the system role.

    Called before `changing` stops being an active Administrator (disabled,
    taken off the Administrator role, or deleted). Without it, the last such
    user could take away the only access to this page there is.
    """
    if not _is_active_administrator(changing):
        return
    others = await User.find(
        User.role == UserRole.admin,
        # Matches any user whose role_ids list contains the system role.
        {"role_ids": SYSTEM_ROLE_ID},
        User.is_active == True,  # noqa: E712 — Beanie builds a query from this
        User.id != changing.id,
    ).count()
    if others == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="at least one active user must keep the Administrator role",
        )


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------


@router.get("/get_roles", response_model=list[RoleItem])
async def get_roles(
    _: User | None = Depends(require_section(Section.users)),
) -> list[RoleItem]:
    roles = await Role.find_all().sort(+Role.id).to_list()
    team = await User.find(User.role == UserRole.admin).to_list()
    counts: dict[int, int] = {}
    for user in team:
        for role_id in user.role_ids:
            counts[role_id] = counts.get(role_id, 0) + 1

    return [
        RoleItem(
            role_id=role.id,
            name=role.name,
            sections=role.sections,
            is_system=role.is_system,
            user_count=counts.get(role.id, 0),
        )
        for role in roles
    ]


@router.post("/add_role", response_model=MessageResponse)
async def add_role(
    payload: AddRoleRequest,
    _: User | None = Depends(require_section(Section.users)),
) -> MessageResponse:
    name = _clean_role_name(payload.name)
    await _ensure_role_name_free(name)

    role_id = await get_next_id(RoleIdCounter, "next_role_id", Role)
    await Role(id=role_id, name=name, sections=_unique_sections(payload.sections)).insert()
    return MessageResponse(message="role added successfully")


@router.post("/update_role", response_model=MessageResponse)
async def update_role(
    payload: UpdateRoleRequest,
    _: User | None = Depends(require_section(Section.users)),
) -> MessageResponse:
    role = await _get_role_or_404(payload.role_id)
    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="the Administrator role can't be changed")

    name = _clean_role_name(payload.name)
    await _ensure_role_name_free(name, excluding_role_id=role.id)

    role.name = name
    role.sections = _unique_sections(payload.sections)
    await role.save()
    return MessageResponse(message="role updated successfully")


@router.post("/delete_role", response_model=MessageResponse)
async def delete_role(
    payload: DeleteRoleRequest,
    _: User | None = Depends(require_section(Section.users)),
) -> MessageResponse:
    role = await _get_role_or_404(payload.role_id)
    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="the Administrator role can't be deleted")

    # Deleting a role in use would quietly take sections away from its users
    # (see get_allowed_sections) — make the admin move them first instead.
    in_use = await User.find(User.role == UserRole.admin, {"role_ids": role.id}).count()
    if in_use:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="this role is still assigned to users")

    await role.delete()
    return MessageResponse(message="role deleted successfully")


# ---------------------------------------------------------------------------
# Team users
# ---------------------------------------------------------------------------


@router.get("/get_users", response_model=list[TeamUserItem])
async def get_users(
    _: User | None = Depends(require_section(Section.users)),
) -> list[TeamUserItem]:
    users = await User.find(User.role == UserRole.admin).sort(+User.id).to_list()
    role_names = {role.id: role.name for role in await Role.find_all().to_list()}
    items = []
    for user in users:
        role_ids = [role_id for role_id in sorted(user.role_ids) if role_id in role_names]
        items.append(
            TeamUserItem(
                user_id=user.id,
                name=user.name,
                mail=user.mail,
                role_ids=role_ids,
                role_names=[role_names[role_id] for role_id in role_ids],
                is_active=user.is_active,
                last_login=user.last_login,
            )
        )
    return items


@router.post("/add_user", response_model=MessageResponse)
async def add_user(
    payload: AddTeamUserRequest,
    _: User | None = Depends(require_section(Section.users)),
) -> MessageResponse:
    mail = _clean_mail(payload.mail)
    _check_password(payload.password)
    await _ensure_mail_free(mail)
    role_ids = await _clean_role_ids(payload.role_ids)

    user_id = await get_next_id(UserIdCounter, "next_user_id", User)
    await User(
        id=user_id,
        name=payload.name.strip(),
        mail=mail,
        password=hash_password(payload.password),
        role=UserRole.admin,
        role_ids=role_ids,
        is_active=payload.is_active,
    ).insert()
    return MessageResponse(message="user added successfully")


@router.post("/update_user", response_model=MessageResponse)
async def update_user(
    payload: UpdateTeamUserRequest,
    current_user: User | None = Depends(require_section(Section.users)),
) -> MessageResponse:
    user = await _get_team_user_or_404(payload.user_id)
    mail = _clean_mail(payload.mail)
    await _ensure_mail_free(mail, excluding_user_id=user.id)
    role_ids = await _clean_role_ids(payload.role_ids)
    if payload.password:
        _check_password(payload.password)

    if current_user is not None and current_user.id == user.id and not payload.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="you can't disable your own account")

    stays_administrator = payload.is_active and SYSTEM_ROLE_ID in role_ids
    if not stays_administrator:
        await _ensure_an_administrator_remains(user)

    user.name = payload.name.strip()
    user.mail = mail
    user.role_ids = role_ids
    user.is_active = payload.is_active
    if payload.password:
        user.password = hash_password(payload.password)
    await user.save()
    return MessageResponse(message="user updated successfully")


@router.post("/delete_user", response_model=MessageResponse)
async def delete_user(
    payload: DeleteTeamUserRequest,
    current_user: User | None = Depends(require_section(Section.users)),
) -> MessageResponse:
    user = await _get_team_user_or_404(payload.user_id)
    if current_user is not None and current_user.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="you can't delete your own account")

    await _ensure_an_administrator_remains(user)
    await user.delete()
    return MessageResponse(message="user deleted successfully")


# ---------------------------------------------------------------------------
# Client logins
# ---------------------------------------------------------------------------


@router.get("/get_client_logins", response_model=list[ClientLoginItem])
async def get_client_logins(
    _: User | None = Depends(require_section(Section.users)),
) -> list[ClientLoginItem]:
    logins = await User.find(User.role == UserRole.customer).sort(+User.id).to_list()
    clients_by_user_id = {client.user_id: client for client in await CustomerDetails.find_all().to_list()}

    items = []
    for login in logins:
        client = clients_by_user_id.get(login.id)
        items.append(
            ClientLoginItem(
                user_id=login.id,
                mail=login.mail,
                registered_name=client.registered_name if client else "",
                company_or_department=client.company_or_department if client else "",
                is_active=login.is_active,
                # A login with no client row can't reach the portal either.
                client_deleted=client is None or client.is_deleted,
                last_login=login.last_login,
            )
        )
    return items


@router.post("/set_client_login_active", response_model=MessageResponse)
async def set_client_login_active(
    payload: SetClientLoginActiveRequest,
    _: User | None = Depends(require_section(Section.users)),
) -> MessageResponse:
    login = await User.get(payload.user_id)
    if login is None or login.role != UserRole.customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="client login not found")

    login.is_active = payload.is_active
    await login.save()
    return MessageResponse(message="client login enabled" if payload.is_active else "client login disabled")
