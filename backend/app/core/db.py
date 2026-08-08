# Manages the MongoDB client lifecycle and exposes the active database instance.
from datetime import datetime, timezone

from beanie import init_beanie
from beanie.operators import In, NotIn
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings
from app.models import (
    CatalogueDetails,
    CatalogueIdCounter,
    CatalogueImageDetails,
    CatalogueImageIdCounter,
    Category,
    CategoryIdCounter,
    CustomerDetails,
    CustomerIdCounter,
    CustomerPocDetails,
    CustomerPocIdCounter,
    InquiryFormNode,
    InquiryFormNodeIdCounter,
    InquiryFormSubmission,
    InquiryFormSubmissionIdCounter,
    Inventory,
    InventoryHistory,
    InventoryHistoryIdCounter,
    InventoryIdCounter,
    InvoiceDetails,
    InvoiceIdCounter,
    InvoiceNoCounterMaster,
    OrderNoCounterMaster,
    OrderStatusMaster,
    PersonalDetails,
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
# "New" (looked up by name in routes/sales_orders.py) and the edit form's
# status dropdown, plus the sales orders tab's status filter tabs, are
# populated from this master list via get_order_status_list.
_ORDER_STATUS_SEED = [
    (1, "New"),
    (2, "Processing"),
    (3, "Delivered"),
    (4, "Completed"),
]

# Initial values for the #personal_details EAV table (see
# app/services/personal_details.py for the attribute<->id mapping), taken
# from Handpikd's own details as supplied by the admin. Bank details and
# terms & conditions weren't provided yet, so those attributes seed to "" and
# get filled in later via the personal details settings screen.
_PERSONAL_DETAILS_SEED = {
    "gstin": "29AAATC9128M1Z9",
    "address": "PLOT NO. 20, GYAN VIHAR, SOGARIYA NEAR RAILWAY COLONY KOTA SUB POST OFFICE KOTA, Rajasthan - 324002",
    "name": "Alvis Abreo",
    "phone": "7411690399",
    "email": "info@handpikd.co",
    "website": "www.handpikd.co",
}


def get_db() -> AsyncDatabase:
    if client is None:
        raise RuntimeError("MongoDB client is not connected")
    return client[settings.mongodb_db_name]


async def _seed_order_statuses() -> None:
    # Reconciles OrderStatusMaster with _ORDER_STATUS_SEED rather than only
    # seeding an empty collection, so renaming/removing a status here takes
    # effect on existing databases too. Any sales order pointing at a status
    # id that's being dropped falls back to the first seed row ("New").
    seed_ids = [status_id for status_id, _ in _ORDER_STATUS_SEED]

    stale_statuses = await OrderStatusMaster.find(NotIn(OrderStatusMaster.id, seed_ids)).to_list()
    if stale_statuses:
        stale_ids = [order_status.id for order_status in stale_statuses]
        orphaned_orders = await SalesOrders.find(In(SalesOrders.order_status_id, stale_ids)).to_list()
        for order in orphaned_orders:
            order.order_status_id = seed_ids[0]
            await order.save()
        for order_status in stale_statuses:
            await order_status.delete()

    for status_id, status_name in _ORDER_STATUS_SEED:
        existing = await OrderStatusMaster.get(status_id)
        if existing is None:
            await OrderStatusMaster(id=status_id, status_name=status_name).insert()
        elif existing.status_name != status_name:
            existing.status_name = status_name
            await existing.save()


async def _seed_personal_details() -> None:
    # One row per app/services/personal_details.ATTRIBUTE_IDS entry,
    # inserted only if missing — never overwrites a value the admin has
    # already edited via the settings screen, same idempotent style as
    # _seed_order_statuses.
    from app.services.personal_details import ATTRIBUTE_IDS

    for attribute, row_id in ATTRIBUTE_IDS.items():
        existing = await PersonalDetails.get(row_id)
        if existing is None:
            await PersonalDetails(
                id=row_id, attribute=attribute, value=_PERSONAL_DETAILS_SEED.get(attribute, "")
            ).insert()


async def _backfill_order_dates() -> None:
    # `date` is a required field on PurchaseOrders/SalesOrders, but any rows
    # inserted before that field existed won't have it — Beanie would raise a
    # validation error the moment such a row is loaded through the ODM. Patch
    # them directly via the raw collection (bypassing Document validation) so
    # they still load once the field becomes required.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db = get_db()
    await db["purchase_orders"].update_many({"date": {"$exists": False}}, {"$set": {"date": now}})
    await db["sales_orders"].update_many({"date": {"$exists": False}}, {"$set": {"date": now}})


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
            InventoryIdCounter,
            InventoryHistory,
            InventoryHistoryIdCounter,
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
            InvoiceIdCounter,
            Category,
            CategoryIdCounter,
            PersonalDetails,
            CatalogueDetails,
            CatalogueIdCounter,
            CatalogueImageDetails,
            CatalogueImageIdCounter,
            InquiryFormNode,
            InquiryFormNodeIdCounter,
            InquiryFormSubmission,
            InquiryFormSubmissionIdCounter,
        ],
    )
    await _seed_order_statuses()
    await _seed_personal_details()
    await _backfill_order_dates()


async def close_mongo_connection() -> None:
    global client
    if client is not None:
        await client.close()
        client = None
