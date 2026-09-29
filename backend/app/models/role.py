# Schema for the #role collection: a named set of admin sections a team
# account (User.role == UserRole.admin) may open. Enforced by require_section
# in app/api/deps.py and mirrored in the admin sidebar
# (frontend/src/lib/access.ts), which hides every section a role lacks.
from enum import Enum

from beanie import Document


class Section(str, Enum):
    # One per admin sidebar entry. The keys are stored on Role documents, so
    # renaming one needs a migration; adding one does not — the system role
    # has every section implicitly, and custom roles simply won't have it
    # until someone ticks it.
    dashboard = "dashboard"
    clients = "clients"
    vendors = "vendors"
    database = "database"
    orders = "orders"
    invoices = "invoices"
    accounts = "accounts"
    inventory = "inventory"
    products = "products"
    categories = "categories"
    catalogues = "catalogues"
    inquiry_form = "inquiry_form"
    product_inquiries = "product_inquiries"
    quotation = "quotation"
    profile = "profile"
    emails = "emails"
    users = "users"


# The built-in "Administrator" role, seeded by _seed_system_role in
# app/core/db.py. It grants every section — including ones added after it
# was created — and can't be edited or deleted, so there is always a way
# back into Users & Roles.
SYSTEM_ROLE_ID = 1


class Role(Document):
    id: int
    name: str
    sections: list[Section] = []
    is_system: bool = False

    class Settings:
        name = "role"
