# Manages the MongoDB client lifecycle and exposes the active database instance.
from datetime import datetime, timezone

from beanie import init_beanie
from beanie.operators import In, NotIn
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings
from app.services.gst import TaxKind
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
    PrintingPurchaseInvoiceDetails,
    PrintingPurchaseInvoiceIdCounter,
    PrintingPurchaseInvoiceNoCounterMaster,
    PrintingPurchaseOrderIdCounter,
    PrintingPurchaseOrders,
    PrintingPurchaseSummary,
    PrintingPurchaseSummaryIdCounter,
    ProductDetails,
    ProductIdCounter,
    ProductImageDetails,
    ProductImageIdCounter,
    ProductInquiry,
    ProductInquiryIdCounter,
    ProformaInvoiceNoCounterMaster,
    ProformaInvoiceSummary,
    ProformaInvoiceSummaryIdCounter,
    PurchaseInvoiceDetails,
    PurchaseInvoiceIdCounter,
    PurchaseInvoiceNoCounterMaster,
    PurchaseOrderIdCounter,
    PurchaseOrders,
    PurchaseSummary,
    PurchaseSummaryIdCounter,
    QuotationDetails,
    QuotationIdCounter,
    QuotationNoCounterMaster,
    QuotationSummary,
    QuotationSummaryIdCounter,
    SalesOrderCosting,
    SalesOrderCostingIdCounter,
    SalesOrderIdCounter,
    SalesOrders,
    SalesSummary,
    SalesSummaryIdCounter,
    StandardInvoiceNoCounterMaster,
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
# from Handpikd's own details as supplied by the admin, cross-checked against
# a real invoice sample (invoice #20, Christ University, 04-Aug-2026).
# state_code/state_name are deliberately absent: their rows are seeded blank
# and derived from whatever `gstin` actually holds, by _with_state_filled_in
# in services/personal_details.py. Seeding a literal "08"/"Rajasthan" here
# would stick to a database whose admin has since changed the GSTIN, and
# every sale would then be billed under the wrong head.
_PERSONAL_DETAILS_SEED = {
    "gstin": "08DINPA7100K1ZA",
    "address": "PLOT NO. 20, GYAN VIHAR, SOGARIYA NEAR RAILWAY COLONY KOTA SUB POST OFFICE KOTA, Rajasthan - 324002",
    "name": "Alvis Abreo",
    "company_name": "Handpikd",
    "phone": "7411690399",
    "email": "info@handpikd.co",
    "website": "https://handpikd.co/",
    "bank_name": "HDFC Bank",
    "bank_branch": "HDFC GUMANPURA",
    "bank_account_name": "ALVIN DARYL ABREO",
    "bank_account_no": "50200113723422",
    "bank_ifsc": "HDFC0000167",
    "invoice_tnc": "\n".join(
        [
            "Goods once sold will not be taken back or exchanged.",
            "Any damage, shortage, or discrepancy must be reported within 48 hours of delivery.",
            "Risk passes to the buyer upon delivery; ownership remains with the seller until full payment is received.",
            "Orders once confirmed cannot be cancelled without seller approval and may attract cancellation charges.",
            "Products are supplied as per manufacturer specifications; no warranty unless explicitly stated.",
            "Seller's liability is limited to the invoice value of the goods supplied. All disputes are subject to Bangalore jurisdiction only.",
        ]
    ),
}

# `_seed_personal_details` only inserts rows that don't exist yet, so it never
# clobbers a value the admin has since edited by hand — but that also means
# it can't fix a value that was already seeded wrong. `gstin` was originally
# seeded with the *customer's* GSTIN from that same sample invoice instead of
# Handpikd's own (Handpikd's is Rajasthan-coded "08...", not Karnataka-coded
# "29..."), and `website` was missing the scheme/slash the sample uses.
# Corrected here, but only while the row still holds exactly that known-wrong
# value, so an admin's manual edit is never overwritten.
_PERSONAL_DETAILS_CORRECTIONS = {
    "gstin": ("29AAATC9128M1Z9", "08DINPA7100K1ZA"),
    "website": ("www.handpikd.co", "https://handpikd.co/"),
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
        elif existing.value == "" and _PERSONAL_DETAILS_SEED.get(attribute):
            # Bank details/T&C were seeded blank before real values existed
            # (see _PERSONAL_DETAILS_SEED's history) — fill them in now that
            # they're known, but only while still untouched/blank.
            existing.value = _PERSONAL_DETAILS_SEED[attribute]
            await existing.save()

    for attribute, (wrong, correct) in _PERSONAL_DETAILS_CORRECTIONS.items():
        row = await PersonalDetails.get(ATTRIBUTE_IDS[attribute])
        if row is not None and row.value == wrong:
            row.value = correct
            await row.save()


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


async def _backfill_product_delete_flag() -> None:
    # `is_deleted` was added to ProductDetails after products were already in
    # the collection, and those rows simply don't have the field. Beanie
    # itself is fine with that (the model defaults it to False), but Mongo is
    # not: an {"is_deleted": false} filter does NOT match a document where the
    # key is absent, so every such product would silently vanish from the
    # storefront the moment get_public_products started filtering on it.
    # Writing the default in once is cheaper than teaching every query to
    # spell the condition as {"$ne": true}.
    db = get_db()
    await db["product_details"].update_many({"is_deleted": {"$exists": False}}, {"$set": {"is_deleted": False}})


async def _backfill_purchase_order_tax_kind() -> None:
    # `tax_kind` was added to PurchaseOrders when the GST rate moved onto the
    # line items (see PurchaseSummary.gst_perc): the rate is per line now, so
    # the order itself only says which heads carry it. Existing orders
    # recorded that implicitly, in whichever of their percentage fields was
    # non-zero, so it can be read straight back out of them.
    #
    # Orders with no percentages at all (zero-rated) are deliberately left
    # None — every amount is 0 either way, and services/purchase_invoices.py
    # already falls back to the two parties' states for those.
    db = get_db()
    await db["purchase_orders"].update_many(
        {"tax_kind": {"$exists": False}, "igst_perc": {"$gt": 0}},
        {"$set": {"tax_kind": TaxKind.igst.value}},
    )
    await db["purchase_orders"].update_many(
        {
            "tax_kind": {"$exists": False},
            "$or": [{"sgst_perc": {"$gt": 0}}, {"cgst_perc": {"$gt": 0}}],
        },
        {"$set": {"tax_kind": TaxKind.cgst_sgst.value}},
    )


async def _backfill_purchase_summary_gst() -> None:
    # Line items written before PurchaseSummary.gst_perc existed carry no
    # rate of their own; their order's header rate is the one that applied to
    # every line, so copying it down leaves those orders costing exactly what
    # they always did.
    #
    # Done here rather than left to the model default because that default is
    # 0.0 — a line silently taxed at nothing, which the purchase invoice PDF
    # and the accounts input tax would both then report as real.
    db = get_db()
    orders = (
        await db["purchase_orders"]
        .find({}, {"_id": 1, "sgst_perc": 1, "cgst_perc": 1, "igst_perc": 1})
        .to_list(length=None)
    )
    rate_by_order_id = {
        order["_id"]: (order.get("sgst_perc") or 0) + (order.get("cgst_perc") or 0) + (order.get("igst_perc") or 0)
        for order in orders
    }

    stale = await db["purchase_summary"].find({"gst_perc": {"$exists": False}}, {"_id": 1, "purchase_order_id": 1}).to_list(length=None)
    for row in stale:
        await db["purchase_summary"].update_one(
            {"_id": row["_id"]},
            {"$set": {"gst_perc": float(rate_by_order_id.get(row.get("purchase_order_id"), 0.0))}},
        )


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
            ProductInquiry,
            ProductInquiryIdCounter,
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
            SalesOrderCosting,
            SalesOrderCostingIdCounter,
            InvoiceNoCounterMaster,
            InvoiceDetails,
            InvoiceIdCounter,
            StandardInvoiceNoCounterMaster,
            ProformaInvoiceNoCounterMaster,
            ProformaInvoiceSummary,
            ProformaInvoiceSummaryIdCounter,
            PurchaseInvoiceDetails,
            PurchaseInvoiceIdCounter,
            PurchaseInvoiceNoCounterMaster,
            PrintingPurchaseOrders,
            PrintingPurchaseOrderIdCounter,
            PrintingPurchaseSummary,
            PrintingPurchaseSummaryIdCounter,
            PrintingPurchaseInvoiceDetails,
            PrintingPurchaseInvoiceIdCounter,
            PrintingPurchaseInvoiceNoCounterMaster,
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
            QuotationNoCounterMaster,
            QuotationDetails,
            QuotationIdCounter,
            QuotationSummary,
            QuotationSummaryIdCounter,
        ],
    )
    await _seed_order_statuses()
    await _seed_personal_details()
    await _backfill_order_dates()
    await _backfill_product_delete_flag()
    await _backfill_purchase_order_tax_kind()
    await _backfill_purchase_summary_gst()


async def close_mongo_connection() -> None:
    global client
    if client is not None:
        await client.close()
        client = None
