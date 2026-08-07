# One-off script: explicitly creates every model's MongoDB collection so the
# full schema is visible in Compass even before any documents are inserted.
# Run with: venv/Scripts/python.exe scripts/create_collections.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings
from app.models import (
    Category,
    CustomerDetails,
    CustomerPocDetails,
    Inventory,
    InvoiceDetails,
    InvoiceNoCounterMaster,
    OrderNoCounterMaster,
    OrderStatusMaster,
    ProductDetails,
    ProductImageDetails,
    PurchaseOrders,
    PurchaseSummary,
    SalesOrderIdCounter,
    SalesOrders,
    SalesSummary,
    SalesSummaryIdCounter,
    User,
    VendorDetails,
    VendorPocDetails,
)

MODELS = [
    User,
    CustomerDetails,
    CustomerPocDetails,
    VendorDetails,
    VendorPocDetails,
    ProductDetails,
    ProductImageDetails,
    Inventory,
    PurchaseOrders,
    PurchaseSummary,
    OrderStatusMaster,
    OrderNoCounterMaster,
    SalesOrders,
    SalesOrderIdCounter,
    SalesSummary,
    SalesSummaryIdCounter,
    InvoiceNoCounterMaster,
    InvoiceDetails,
    Category,
]


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    existing = set(await db.list_collection_names())

    for model in MODELS:
        name = model.Settings.name
        if name in existing:
            print(f"skip (already exists): {name}")
            continue
        await db.create_collection(name)
        print(f"created: {name}")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
