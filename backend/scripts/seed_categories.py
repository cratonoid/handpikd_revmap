# One-off script: builds the Drinkware / Electronics and accessories category
# tree by calling the real add_category HTTP API (backend/app/api/routes/
# categories.py), the same way the admin UI does. Safe to re-run — existing
# (parent_id, category_name) pairs are detected via get_categories and reused
# instead of duplicated.
import os
import sys

import httpx

BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000/api/v1")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@gmail.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password")

# Each node: (name, [children...]). Mirrors the spreadsheet exactly —
# rows with a blank cell in a column inherit that column's last non-blank
# value (merged-cell convention), which is how e.g. "Wireless Charger" ends
# up nested under "Mobile Charger" rather than being a sibling of it.
CATEGORY_TREE = [
    ("Drinkware", [
        ("Mugs", [
            ("Stainless Steel", []),
            ("Hot n Cold", []),
            ("Ceramic", []),
            ("Glass", []),
        ]),
        ("Bottles", [
            ("Stainless Steel", []),
            ("Hot n Cold", []),
            ("Plastic", []),
            ("Bamboo", []),
        ]),
        ("Juicer", []),
    ]),
    ("Electronics and accessories", [
        ("Mobile Accessories", [
            ("Power Bank", [
                ("wired", []),
                ("wireless", []),
            ]),
            ("Cable(multi)", []),
            ("Mobile Charger", [
                ("With cable", []),
                ("Wireless Charger", []),
            ]),
        ]),
        ("Computer/Laptop Accessories", [
            ("Mouse", []),
            ("Laptop Stand", []),
        ]),
        ("Desk Accessories", [
            ("Clock", []),
            ("Lamp", []),
            ("Pen Stand", [
                ("Wooden", []),
                ("Metal", []),
                ("Plastic", []),
                ("Leather", []),
            ]),
            ("Desk Fan", []),
            ("Mobile Stand", [
                ("Plain", []),
                ("With Charger", []),
            ]),
        ]),
        ("Other", [
            ("Earphones", []),
            ("Music Player", []),
            ("Bluetooth Speaker", []),
        ]),
    ]),
]


def login() -> str:
    resp = httpx.post(f"{BASE_URL}/authentication/login_auth", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if not resp.is_success:
        print(f"login failed ({resp.status_code}): {resp.text}", file=sys.stderr)
        sys.exit(1)
    return resp.json()["access_token"]


def fetch_existing(client: httpx.Client) -> dict[tuple[int | None, str], int]:
    resp = client.get(f"{BASE_URL}/admin/categories/get_categories")
    resp.raise_for_status()
    return {(item["parent_id"], item["category_name"]): item["id"] for item in resp.json()}


def add_category(client: httpx.Client, name: str, parent_id: int | None, existing: dict[tuple[int | None, str], int]) -> int:
    key = (parent_id, name)
    if key in existing:
        print(f"  skip (exists): {name!r} under parent_id={parent_id} -> id={existing[key]}")
        return existing[key]

    resp = client.post(f"{BASE_URL}/admin/categories/add_category", json={"category_name": name, "parent_id": parent_id})
    if not resp.is_success:
        print(f"failed to add {name!r} under parent_id={parent_id}: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)

    refreshed = fetch_existing(client)
    existing.clear()
    existing.update(refreshed)
    new_id = existing[key]
    print(f"  added: {name!r} under parent_id={parent_id} -> id={new_id}")
    return new_id


def walk(client: httpx.Client, nodes, parent_id: int | None, existing: dict[tuple[int | None, str], int]) -> None:
    for name, children in nodes:
        node_id = add_category(client, name, parent_id, existing)
        walk(client, children, node_id, existing)


def main() -> None:
    token = login()
    client = httpx.Client(headers={"Authorization": f"Bearer {token}"})

    existing = fetch_existing(client)
    walk(client, CATEGORY_TREE, None, existing)
    print("done.")


if __name__ == "__main__":
    main()
