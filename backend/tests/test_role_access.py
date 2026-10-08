# Unit tests for role-based section access (app/api/deps.py) and the
# helpers behind the Users & Roles module (app/api/routes/users.py).
#
# Role lookups are stubbed rather than queried — same approach as
# test_customer_invoice_access.py — so no Mongo connection is needed.
import asyncio
import importlib
import pkgutil

import pytest
from fastapi import HTTPException
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.api import deps
from app.api import routes as routes_package
from app.api.routes import users
from app.models import SYSTEM_ROLE_ID, Section, UserRole


class _StubUser:
    def __init__(self, role: UserRole = UserRole.admin, role_ids: list[int] | None = None) -> None:
        self.id = 7
        self.role = role
        self.role_ids = [2] if role_ids is None else role_ids
        self.is_active = True


class _StubRole:
    def __init__(self, sections: list[Section], is_system: bool = False) -> None:
        self.sections = sections
        self.is_system = is_system


def _stub_roles(monkeypatch: pytest.MonkeyPatch, roles: dict[int, _StubRole]) -> None:
    async def fake_get(role_id: int):
        return roles.get(role_id)

    monkeypatch.setattr(deps.Role, "get", fake_get)


def test_system_role_grants_every_section(monkeypatch):
    _stub_roles(monkeypatch, {SYSTEM_ROLE_ID: _StubRole([], is_system=True)})
    assert asyncio.run(deps.get_allowed_sections(_StubUser(role_ids=[SYSTEM_ROLE_ID]))) is None


def test_custom_role_grants_only_its_sections(monkeypatch):
    _stub_roles(monkeypatch, {2: _StubRole([Section.orders, Section.products])})
    assert asyncio.run(deps.get_allowed_sections(_StubUser())) == {Section.orders, Section.products}


def test_several_roles_grant_every_section_between_them(monkeypatch):
    _stub_roles(monkeypatch, {2: _StubRole([Section.orders]), 3: _StubRole([Section.products, Section.orders])})
    assert asyncio.run(deps.get_allowed_sections(_StubUser(role_ids=[2, 3]))) == {Section.orders, Section.products}


def test_system_role_among_several_grants_every_section(monkeypatch):
    _stub_roles(monkeypatch, {2: _StubRole([Section.orders]), SYSTEM_ROLE_ID: _StubRole([], is_system=True)})
    assert asyncio.run(deps.get_allowed_sections(_StubUser(role_ids=[2, SYSTEM_ROLE_ID]))) is None


@pytest.mark.parametrize("role_ids", [[], [99]])
def test_missing_role_grants_nothing(monkeypatch, role_ids):
    # Never assigned, or pointing at a role that no longer exists: fail closed.
    _stub_roles(monkeypatch, {})
    assert asyncio.run(deps.get_allowed_sections(_StubUser(role_ids=role_ids))) == set()


def test_require_section_allows_any_listed_section(monkeypatch):
    _stub_roles(monkeypatch, {2: _StubRole([Section.orders])})
    user = _StubUser()
    check = deps.require_section(Section.invoices, Section.orders)
    assert asyncio.run(check(current_user=user)) is user


def test_require_section_refuses_other_sections(monkeypatch):
    _stub_roles(monkeypatch, {2: _StubRole([Section.orders])})
    check = deps.require_section(Section.accounts)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(check(current_user=_StubUser()))
    assert caught.value.status_code == 403


def test_require_section_passes_when_auth_is_disabled():
    # require_staff resolves to None with AUTH_ENABLED off; nothing to check.
    assert asyncio.run(deps.require_section(Section.accounts)(current_user=None)) is None


def test_require_staff_refuses_client_logins():
    with pytest.raises(HTTPException) as caught:
        asyncio.run(deps.require_staff(current_user=_StubUser(role=UserRole.customer)))
    assert caught.value.status_code == 403


def _depends_on_require_staff(dependant: Dependant) -> bool:
    return any(
        sub.call is deps.require_staff or _depends_on_require_staff(sub) for sub in dependant.dependencies
    )


def _module_routes() -> list[tuple[str, APIRoute]]:
    # Read off each routes/*.py module's own `router` rather than the mounted
    # app, whose included routers are an internal FastAPI structure. Picks up
    # a new module automatically.
    found = []
    for module_info in pkgutil.iter_modules(routes_package.__path__):
        module = importlib.import_module(f"{routes_package.__name__}.{module_info.name}")
        router = getattr(module, "router", None)
        if router is None:
            continue
        found.extend((route.path, route) for route in router.routes if isinstance(route, APIRoute))
    return found


def test_every_admin_endpoint_is_behind_require_staff():
    # A new /admin endpoint that forgets its dependency would be open to any
    # client login (or, with no token at all, anyone). Every section check
    # builds on require_staff, so this catches both.
    admin_routes = [(path, route) for path, route in _module_routes() if path.startswith("/admin/")]
    assert len(admin_routes) > 50
    unguarded = [path for path, route in admin_routes if not _depends_on_require_staff(route.dependant)]
    assert unguarded == []


def test_unique_sections_dedupes_in_sidebar_order():
    assert users._unique_sections([Section.users, Section.orders, Section.users, Section.dashboard]) == [
        Section.dashboard,
        Section.orders,
        Section.users,
    ]


def test_role_name_is_trimmed_and_required():
    assert users._clean_role_name("  Sales  ") == "Sales"
    with pytest.raises(HTTPException) as caught:
        users._clean_role_name("   ")
    assert caught.value.status_code == 400


def test_password_minimum_length():
    users._check_password("12345678")
    with pytest.raises(HTTPException) as caught:
        users._check_password("short")
    assert caught.value.status_code == 400


def test_only_active_administrators_count_as_administrators():
    admin = _StubUser(role_ids=[2, SYSTEM_ROLE_ID])
    assert users._is_active_administrator(admin)

    admin.is_active = False
    assert not users._is_active_administrator(admin)
    assert not users._is_active_administrator(_StubUser(role_ids=[2]))
