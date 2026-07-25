# Manages the MongoDB client lifecycle and exposes the active database instance.
from beanie import init_beanie
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

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
    SalesOrders,
    SalesSummary,
    User,
    VendorDetails,
    VendorPocDetails,
)

client: AsyncMongoClient | None = None


def get_db() -> AsyncDatabase:
    if client is None:
        raise RuntimeError("MongoDB client is not connected")
    return client[settings.mongodb_db_name]


async def connect_to_mongo() -> None:
    global client
    client = AsyncMongoClient(settings.mongodb_uri)
    await init_beanie(
        database=client[settings.mongodb_db_name],
        document_models=[
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
            SalesSummary,
            InvoiceNoCounterMaster,
            InvoiceDetails,
            Category,
        ],
    )


async def close_mongo_connection() -> None:
    global client
    if client is not None:
        await client.close()
        client = None
