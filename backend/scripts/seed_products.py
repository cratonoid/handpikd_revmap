# One-off script: creates one ProductDetails row per leaf category in the
# Drinkware / Electronics and accessories tree (see seed_categories.py for
# the same tree), via the real add_product_details HTTP API — same approach
# as seed_categories.py. Safe to re-run: existing products (matched by
# product_name) are skipped rather than duplicated.
#
# Every field ProductDetails needs beyond a category tag (HSN code, GST%,
# vendor rate, actual/discounted price) has no source data yet, so this
# fills them with obvious placeholders (hsn_code "0000", 0% GST, moq 1, zero
# prices) for an admin to correct later via the /admin/products page.
# product_name is a short vendor-code + sequential number ("MC-001",
# "AS-001", ...); the human-readable variant name goes in `description`
# instead.
import os
import sys

import httpx

BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000/api/v1")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@gmail.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password")

# Mirrors seed_categories.py's CATEGORY_TREE exactly, so this script can
# resolve/ensure the same leaf category ids without depending on that script
# having been run first.
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

# Shorthand for the root category name, to keep the DESCRIPTIONS/VENDOR_BY_ROOT
# entries below from wrapping.
ELEC = "Electronics and accessories"

# Every leaf's full path (from the root category down to itself) -> a
# human-readable description. Only leaves appear here — branch categories
# (e.g. "Mugs", "Pen Stand") aren't products themselves.
DESCRIPTIONS: dict[tuple[str, ...], str] = {
    ("Drinkware", "Mugs", "Stainless Steel"): "Stainless Steel Mug",
    ("Drinkware", "Mugs", "Hot n Cold"): "Hot n Cold Mug",
    ("Drinkware", "Mugs", "Ceramic"): "Ceramic Mug",
    ("Drinkware", "Mugs", "Glass"): "Glass Mug",
    ("Drinkware", "Bottles", "Stainless Steel"): "Stainless Steel Bottle",
    ("Drinkware", "Bottles", "Hot n Cold"): "Hot n Cold Bottle",
    ("Drinkware", "Bottles", "Plastic"): "Plastic Bottle",
    ("Drinkware", "Bottles", "Bamboo"): "Bamboo Bottle",
    ("Drinkware", "Juicer"): "Juicer",
    (ELEC, "Mobile Accessories", "Power Bank", "wired"): "Wired Power Bank",
    (ELEC, "Mobile Accessories", "Power Bank", "wireless"): "Wireless Power Bank",
    (ELEC, "Mobile Accessories", "Cable(multi)"): "Multi-Pin Charging Cable",
    (ELEC, "Mobile Accessories", "Mobile Charger", "With cable"): "Mobile Charger with Cable",
    (ELEC, "Mobile Accessories", "Mobile Charger", "Wireless Charger"): "Wireless Mobile Charger",
    (ELEC, "Computer/Laptop Accessories", "Mouse"): "Computer Mouse",
    (ELEC, "Computer/Laptop Accessories", "Laptop Stand"): "Laptop Stand",
    (ELEC, "Desk Accessories", "Clock"): "Desk Clock",
    (ELEC, "Desk Accessories", "Lamp"): "Desk Lamp",
    (ELEC, "Desk Accessories", "Pen Stand", "Wooden"): "Wooden Pen Stand",
    (ELEC, "Desk Accessories", "Pen Stand", "Metal"): "Metal Pen Stand",
    (ELEC, "Desk Accessories", "Pen Stand", "Plastic"): "Plastic Pen Stand",
    (ELEC, "Desk Accessories", "Pen Stand", "Leather"): "Leather Pen Stand",
    (ELEC, "Desk Accessories", "Desk Fan"): "Desk Fan",
    (ELEC, "Desk Accessories", "Mobile Stand", "Plain"): "Mobile Stand",
    (ELEC, "Desk Accessories", "Mobile Stand", "With Charger"): "Mobile Stand with Charger",
    (ELEC, "Other", "Earphones"): "Earphones",
    (ELEC, "Other", "Music Player"): "Portable Music Player",
    (ELEC, "Other", "Bluetooth Speaker"): "Bluetooth Speaker",
}

# Top-level category name -> (vendor_name, product_name prefix). Drinkware
# products go to Mutha Collections ("MC-001", "MC-002", ...); Electronics
# and accessories products go to amrit shoes ("AS-001", "AS-002", ...) —
# numbering restarts at 001 for each vendor.
VENDOR_BY_ROOT = {
    "Drinkware": ("Mutha Collections", "MC"),
    ELEC: ("amrit shoes", "AS"),
}

# add_product_details rejects a second product reusing an HSN code under a
# different name (see _validate_hsn_code_product_name in routes/products.py),
# so a single shared placeholder HSN won't work here — each product gets its
# own obviously-fake one instead ("00000001", "00000002", ...).
def placeholder_hsn_code(seq: int) -> str:
    return f"{seq:08d}"


PLACEHOLDER_GST_PERC = 0.0
PLACEHOLDER_MOQ = 1


def login() -> str:
    resp = httpx.post(f"{BASE_URL}/authentication/login_auth", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if not resp.is_success:
        print(f"login failed ({resp.status_code}): {resp.text}", file=sys.stderr)
        sys.exit(1)
    return resp.json()["access_token"]


def fetch_existing_categories(client: httpx.Client) -> dict[tuple[int | None, str], int]:
    resp = client.get(f"{BASE_URL}/admin/categories/get_categories")
    resp.raise_for_status()
    return {(item["parent_id"], item["category_name"]): item["category_id"] for item in resp.json()}


def ensure_category(
    client: httpx.Client, name: str, parent_id: int | None, existing: dict[tuple[int | None, str], int]
) -> int:
    key = (parent_id, name)
    if key in existing:
        return existing[key]

    resp = client.post(
        f"{BASE_URL}/admin/categories/add_category", json={"category_name": name, "parent_id": parent_id}
    )
    if not resp.is_success:
        msg = f"failed to add category {name!r} under parent_id={parent_id}: {resp.status_code} {resp.text}"
        print(msg, file=sys.stderr)
        sys.exit(1)

    refreshed = fetch_existing_categories(client)
    existing.clear()
    existing.update(refreshed)
    return existing[key]


def ensure_category_tree(
    client: httpx.Client, nodes, parent_id: int | None, existing: dict[tuple[int | None, str], int]
) -> None:
    for name, children in nodes:
        node_id = ensure_category(client, name, parent_id, existing)
        ensure_category_tree(client, children, node_id, existing)


def leaf_category_id(path: tuple[str, ...], existing: dict[tuple[int | None, str], int]) -> int:
    parent_id: int | None = None
    for name in path:
        parent_id = existing[(parent_id, name)]
    return parent_id  # after the loop, this is the leaf's own id


def fetch_vendor_ids(client: httpx.Client) -> dict[str, int]:
    resp = client.get(f"{BASE_URL}/admin/get_vendors_list")
    resp.raise_for_status()
    return {item["vendor_name"]: item["vendor_id"] for item in resp.json()}


def fetch_existing_product_names(client: httpx.Client) -> set[str]:
    resp = client.get(f"{BASE_URL}/admin/get_product_details")
    resp.raise_for_status()
    return {item["product_name"] for item in resp.json()}


def add_product(
    client: httpx.Client, product_name: str, description: str, vendor_id: int, category_id: int, hsn_code: str
) -> None:
    payload = {
        "product_name": product_name,
        "hsn_code": hsn_code,
        "vendor_id": vendor_id,
        "vendor_rate": 0,
        "actual_price": 0,
        "discounted_price": 0,
        "gst_perc": PLACEHOLDER_GST_PERC,
        "category_ids": [category_id],
        "moq": PLACEHOLDER_MOQ,
        "description": description,
        "is_visible": True,
        "image_paths": [],
    }
    resp = client.post(f"{BASE_URL}/admin/add_product_details", json=payload)
    if not resp.is_success:
        print(f"failed to add product {product_name!r}: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)
    print(f"  added: {product_name} ({description}) -> category_id={category_id}, vendor_id={vendor_id}")


def main() -> None:
    token = login()
    client = httpx.Client(headers={"Authorization": f"Bearer {token}"})

    existing_categories = fetch_existing_categories(client)
    ensure_category_tree(client, CATEGORY_TREE, None, existing_categories)

    vendor_ids = fetch_vendor_ids(client)
    for vendor_name, _ in VENDOR_BY_ROOT.values():
        if vendor_name not in vendor_ids:
            print(f"vendor {vendor_name!r} not found in {sorted(vendor_ids)}", file=sys.stderr)
            sys.exit(1)

    existing_product_names = fetch_existing_product_names(client)

    # Sequential per-vendor counters, e.g. MC-001, MC-002, ... / AS-001, AS-002, ...
    next_seq: dict[str, int] = {prefix: 1 for _, prefix in VENDOR_BY_ROOT.values()}

    for hsn_seq, (path, description) in enumerate(DESCRIPTIONS.items(), start=1):
        root = path[0]
        vendor_name, prefix = VENDOR_BY_ROOT[root]
        vendor_id = vendor_ids[vendor_name]
        category_id = leaf_category_id(path, existing_categories)

        product_name = f"{prefix}-{next_seq[prefix]:03d}"
        next_seq[prefix] += 1

        if product_name in existing_product_names:
            print(f"  skip (exists): {product_name} ({description})")
            continue

        add_product(client, product_name, description, vendor_id, category_id, placeholder_hsn_code(hsn_seq))

    print("done.")


if __name__ == "__main__":
    main()
