# Manages the MongoDB client lifecycle and exposes the active database instance.
from beanie import init_beanie
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings
from app.models import (
    Category,
    CategoryIdCounter,
    CustomerDetails,
    CustomerIdCounter,
    CustomerPocDetails,
    CustomerPocIdCounter,
    Inventory,
    InvoiceDetails,
    InvoiceNoCounterMaster,
    OrderNoCounterMaster,
    OrderStatusMaster,
    ProductDetails,
    ProductIdCounter,
    ProductImageDetails,
    ProductImageIdCounter,
    PurchaseOrderIdCounter,
    PurchaseOrders,
    PurchaseSummary,
    PurchaseSummaryIdCounter,
    SalesOrderIdCounter,
    SalesOrders,
    SalesSummary,
    SalesSummaryIdCounter,
    User,
    UserIdCounter,
    VendorDetails,
    VendorIdCounter,
    VendorPocDetails,
    VendorPocIdCounter,
)

client: AsyncMongoClient | None = None

# Fixed seed rows for the sales order lifecycle — new sales orders default to
# "Pending" (looked up by name in routes/sales_orders.py) and the edit form's
# status dropdown is populated from this master list via get_order_status_list.
_ORDER_STATUS_SEED = [
    (1, "Pending"),
    (2, "Confirmed"),
    (3, "Shipped"),
    (4, "Delivered"),
    (5, "Cancelled"),
]


def get_db() -> AsyncDatabase:
    if client is None:
        raise RuntimeError("MongoDB client is not connected")
    return client[settings.mongodb_db_name]


async def _seed_order_statuses() -> None:
    if await OrderStatusMaster.find_all().count() > 0:
        return
    for status_id, status_name in _ORDER_STATUS_SEED:
        await OrderStatusMaster(id=status_id, status_name=status_name).insert()


async def connect_to_mongo() -> None:
    global client
    client = AsyncMongoClient(settings.mongodb_uri)
    await init_beanie(
        database=client[settings.mongodb_db_name],
        document_models=[
            User,
            UserIdCounter,
            CustomerDetails,
            CustomerIdCounter,
            CustomerPocDetails,
            CustomerPocIdCounter,
            VendorDetails,
            VendorIdCounter,
            VendorPocDetails,
            VendorPocIdCounter,
            ProductDetails,
            ProductIdCounter,
            ProductImageDetails,
            ProductImageIdCounter,
            Inventory,
            PurchaseOrders,
            PurchaseOrderIdCounter,
            PurchaseSummary,
            PurchaseSummaryIdCounter,
            OrderStatusMaster,
            OrderNoCounterMaster,
            SalesOrders,
            SalesOrderIdCounter,
            SalesSummary,
            SalesSummaryIdCounter,
            InvoiceNoCounterMaster,
            InvoiceDetails,
            Category,
            CategoryIdCounter,
        ],
    )
    await _seed_order_statuses()


async def close_mongo_connection() -> None:
    global client
    if client is not None:
        await client.close()
        client = None
