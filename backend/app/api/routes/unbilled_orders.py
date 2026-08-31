# Unbilled orders module: endpoints for recording stock bought WITHOUT a
# bill, restricted to admins (bypassed entirely when settings.auth_enabled is
# False, matching require_admin in routes/admin.py).
#
# The third purchase module, after routes/orders.py (material) and
# routes/printing_orders.py (printing). What it does and does not share with
# them is the whole design:
#
#   - Like material, and unlike printing, it MOVES STOCK. Its line items are
#     real ProductDetails rows and creating one calls into
#     services/inventory.py exactly as the material side does. Unbilled stock
#     is sellable stock; that is why it is worth recording at all.
#   - Unlike material, there is no vendor invoice anywhere in it: no GSTIN
#     requirement on the vendor, no vendor invoice number, no per-line GST
#     rate, no tax heads, and NO PURCHASE INVOICE RAISED. There is nothing in
#     this module's imports that could reach the invoice or GST code by
#     accident — compare create_new_purchase_order, which ends by calling
#     create_purchase_invoice_for_order.
#
# The one thing with no counterpart next door is inline product creation. A
# local-market buy is precisely a thing that is not in the catalogue, so a
# line item names its product instead of picking one, and
# _create_missing_products makes a minimal ProductDetails row (no HSN code,
# 0% GST, never storefront-visible) the first time a name is used. Unbilled
# products are told apart by that name — see ProductDetails.is_unbilled — so
# the second use of a name finds the first one's product rather than making
# a second.
from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin

# The one rule that says whether two product names are "the same" name. It
# lives next door because that is where (hsn_code, product_name) uniqueness
# is enforced, and unbilled products are exactly the case of that rule where
# the code is "" — so they have to normalise names identically, or the two
# checks would disagree about what counts as a duplicate.
from app.api.routes.products import _normalised_product_name
from app.models import (
    ProductDetails,
    ProductIdCounter,
    SalesOrders,
    UnbilledPurchaseOrderIdCounter,
    UnbilledPurchaseOrders,
    UnbilledPurchaseSummary,
    UnbilledPurchaseSummaryIdCounter,
    User,
    VendorDetails,
)
from app.schemas.unbilled_purchase_orders import (
    CreateNewUnbilledPurchaseOrderRequest,
    CreateNewUnbilledPurchaseOrderResponse,
    UnbilledProductListItem,
    UnbilledPurchaseOrderDetailItem,
    UnbilledPurchaseOrderListItem,
    UpdateUnbilledPurchaseOrderDetailsRequest,
    UpdateUnbilledPurchaseOrderDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.inventory import (
    STOCK_IN,
    apply_unbilled_purchase_order_stock,
    compute_stock_deltas,
    find_stock_shortfalls,
    get_applied_unbilled_purchase_quantities,
    totals_by_product,
)

router = APIRouter(prefix="/admin", tags=["unbilled-orders"])


async def _get_vendor_or_404(vendor_id: int) -> VendorDetails:
    vendor = await VendorDetails.get(vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    # Deliberately no _require_vendor_has_gst and no vendor_type check, the
    # two gates the material and printing sides apply here. A supplier who
    # raises no bill routinely has no GST number on file, and refusing them
    # would make this module unusable for the very case it exists for.
    return vendor


def _compute_total(quantities: list[int], rates: list[float]) -> float:
    # No tax term, unlike _compute_totals in routes/orders.py: an unbilled
    # purchase costs what was paid.
    return sum(quantity * rate for quantity, rate in zip(quantities, rates))


async def _find_unbilled_product_by_name(product_name: str) -> ProductDetails | None:
    # Unbilled products are identified by name (they all share the empty HSN
    # code), so this decides whether a typed name is a new product or one
    # already on file. Scoped to un-deleted rows for the same reason
    # _validate_hsn_code_product_name is: a name is only taken while a live
    # product holds it.
    candidates = await ProductDetails.find(
        ProductDetails.hsn_code == "",
        ProductDetails.is_deleted == False,  # noqa: E712 — Beanie needs the comparison, not `is False`
    ).to_list()
    incoming_name = _normalised_product_name(product_name)

    for candidate in candidates:
        if _normalised_product_name(candidate.product_name) != incoming_name:
            continue
        if not candidate.is_unbilled:
            # A billed product filed under no HSN code already holds this
            # name. Adding an unbilled one alongside it would make the
            # (hsn_code, product_name) pair ambiguous, which is exactly what
            # _validate_hsn_code_product_name exists to prevent — so it is
            # refused here rather than left to fail when either product is
            # next edited through the product form.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"a product named '{candidate.product_name}' already exists with no HSN code — "
                    "give this one a different name, or add an HSN code to that product"
                ),
            )
        return candidate

    return None


async def _resolve_existing_products(
    product_ids: list[int | None], product_names: list[str], reject_deleted: bool
) -> list[int | None]:
    """Each line's product id where it already exists, None where it must be created.

    Writes nothing. Splitting resolution from creation is what lets an update
    check its stock deltas BEFORE any product row is inserted, so a rejected
    edit leaves no half-made product behind.
    """
    known_ids = [product_id for product_id in product_ids if product_id is not None]
    products = await ProductDetails.find(In(ProductDetails.id, known_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    resolved: list[int | None] = []
    for product_id, product_name in zip(product_ids, product_names):
        if product_id is None:
            existing = await _find_unbilled_product_by_name(product_name)
            resolved.append(existing.id if existing is not None else None)
            continue

        product = products_by_id.get(product_id)
        if product is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")
        if reject_deleted and product.is_deleted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"product {product_id} has been deleted"
            )
        if not product.is_unbilled:
            # The mirror of the guard the material side grew in
            # _validate_products_belong_to_vendor: a billed product belongs
            # on a billed purchase order, where its HSN code and GST rate
            # mean something. Letting one in here would record a taxed
            # purchase as untaxed and quietly forfeit the input credit on it.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"product {product_id} is a billed product — record it on a billed purchase order",
            )
        resolved.append(product_id)

    return resolved


async def _create_missing_products(
    resolved: list[int | None], product_names: list[str], rates: list[float], vendor_id: int
) -> list[int]:
    """Fills every None left by _resolve_existing_products with a newly created product.

    Two lines naming the same new product create ONE product between them —
    the name is the identity, so the second line finds what the first just
    made.
    """
    final_ids: list[int] = []
    created_by_name: dict[str, int] = {}

    for product_id, product_name, rate in zip(resolved, product_names, rates):
        if product_id is not None:
            final_ids.append(product_id)
            continue

        normalised = _normalised_product_name(product_name)
        if normalised in created_by_name:
            final_ids.append(created_by_name[normalised])
            continue

        new_product_id = await get_next_id(ProductIdCounter, "next_product_id", ProductDetails)
        await ProductDetails(
            id=new_product_id,
            # Stored exactly as typed, like every other product name; only
            # duplicate detection normalises.
            product_name=product_name.strip(),
            # The two fields that make this an unbilled product. No vendor
            # document classified these goods, so there is no HSN code to
            # record and no rate they are taxed at — the sales order line
            # defaults to 0% and the admin overrides it there if the sale
            # itself is taxed.
            hsn_code="",
            gst_perc=0.0,
            vendor_id=vendor_id,
            # What was actually paid, so #sales_order_costing defaults this
            # line's cost correctly the first time the order is costed (see
            # SalesOrderCosting.net_purchase_rate).
            vendor_rate=rate,
            # Left at 0 rather than guessed from the purchase rate: no
            # selling price has been decided at the moment stock is bought,
            # and a made-up one would auto-fill the sales order form with a
            # number nobody chose. The admin types the rate on the sale.
            actual_price=0.0,
            discounted_price=0.0,
            category_ids=[],
            moq=1,
            description="",
            # Never on the storefront. services/inventory.py's
            # _set_product_visibility also refuses to flip this on when stock
            # arrives, which is the path that would otherwise undo it.
            is_visible=False,
            is_unbilled=True,
        ).insert()

        created_by_name[normalised] = new_product_id
        final_ids.append(new_product_id)

    return final_ids


async def _reject_stock_going_negative(stock_deltas: dict[int, int]) -> None:
    # Same rule as the material side's: an edit that cuts a purchased
    # quantity below what has since been sold on would drive #inventory
    # negative, and the admin has to correct the sales side first.
    shortfalls = await find_stock_shortfalls(stock_deltas)
    if not shortfalls:
        return

    details = ", ".join(
        f"product {product_id} (on hand {on_hand}, this edit removes {-delta})"
        for product_id, on_hand, delta in shortfalls
    )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"this edit would take stock negative for: {details}",
    )


async def _flag_related_sales_orders(unbilled_purchase_order_id: int) -> None:
    # The unbilled twin of _flag_related_sales_orders in routes/orders.py,
    # raising the same SalesOrders.po_updated_flag: a notice for the admin to
    # review the linked sales order, never an automatic sync. Which of the
    # two lists the edited order sits on doesn't change what the admin has to
    # do about it, so there is one flag rather than two.
    related_orders = await SalesOrders.find(
        SalesOrders.related_unbilled_purchase_order_ids == unbilled_purchase_order_id,
        SalesOrders.is_deleted == False,  # noqa: E712 — Beanie needs the comparison, not `is False`
    ).to_list()
    for sales_order in related_orders:
        sales_order.po_updated_flag = True
        await sales_order.save()


async def _insert_summary_rows(
    unbilled_purchase_order_id: int, product_ids: list[int], quantities: list[int], rates: list[float]
) -> None:
    for product_id, quantity, rate in zip(product_ids, quantities, rates):
        summary_id = await get_next_id(
            UnbilledPurchaseSummaryIdCounter,
            "next_unbilled_purchase_summary_id",
            UnbilledPurchaseSummary,
        )
        await UnbilledPurchaseSummary(
            id=summary_id,
            unbilled_purchase_order_id=unbilled_purchase_order_id,
            product_id=product_id,
            quantity=quantity,
            rate=rate,
        ).insert()


@router.post("/create_new_unbilled_purchase_order", response_model=CreateNewUnbilledPurchaseOrderResponse)
async def create_new_unbilled_purchase_order(
    payload: CreateNewUnbilledPurchaseOrderRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewUnbilledPurchaseOrderResponse:
    await _get_vendor_or_404(payload.vendor_id)

    resolved = await _resolve_existing_products(payload.product_ids, payload.product_names, reject_deleted=True)
    product_ids = await _create_missing_products(
        resolved, payload.product_names, payload.rates, payload.vendor_id
    )

    unbilled_purchase_order_id = await get_next_id(
        UnbilledPurchaseOrderIdCounter,
        "next_unbilled_purchase_order_id",
        UnbilledPurchaseOrders,
    )
    # Generated, not entered — there is no vendor document to take a number
    # from. See UnbilledPurchaseOrders.purchase_order_no.
    purchase_order_no = f"UPO-{unbilled_purchase_order_id}"

    unbilled_purchase_order = UnbilledPurchaseOrders(
        id=unbilled_purchase_order_id,
        purchase_order_no=purchase_order_no,
        vendor_id=payload.vendor_id,
        date=payload.date,
        total_amount=_compute_total(payload.quantities, payload.rates),
        description=payload.description,
    )
    await unbilled_purchase_order.insert()

    await _insert_summary_rows(unbilled_purchase_order_id, product_ids, payload.quantities, payload.rates)
    # Nothing is applied yet for a brand new order, so the deltas are just
    # the purchased quantities — all of them stock coming in, never negative.
    await apply_unbilled_purchase_order_stock(
        unbilled_purchase_order_id,
        product_ids,
        payload.quantities,
        totals_by_product(product_ids, payload.quantities),
    )

    # No create_purchase_invoice_for_order call, and no endpoint that would
    # raise one later either: an unbilled purchase has no invoice, which is
    # what makes it unbilled.
    return CreateNewUnbilledPurchaseOrderResponse(
        message="unbilled purchase order successfully created",
        id=unbilled_purchase_order_id,
        purchase_order_no=purchase_order_no,
    )


@router.get("/get_unbilled_purchase_order_list", response_model=list[UnbilledPurchaseOrderListItem])
async def get_unbilled_purchase_order_list(
    _: User | None = Depends(require_admin),
) -> list[UnbilledPurchaseOrderListItem]:
    # Lightweight list for the sales order form's "related unbilled
    # purchases" multiselect — the twin of get_purchase_order_list.
    orders = await UnbilledPurchaseOrders.find_all().to_list()
    if not orders:
        return []

    vendor_ids = [order.vendor_id for order in orders]
    vendors = await VendorDetails.find(In(VendorDetails.id, vendor_ids)).to_list()
    vendor_names_by_id = {vendor.id: vendor.registered_name for vendor in vendors}

    return [
        UnbilledPurchaseOrderListItem(
            id=order.id,
            purchase_order_no=order.purchase_order_no,
            vendor_name=vendor_names_by_id.get(order.vendor_id, "—"),
        )
        for order in orders
    ]


@router.get("/get_unbilled_products", response_model=list[UnbilledProductListItem])
async def get_unbilled_products(
    _: User | None = Depends(require_admin),
) -> list[UnbilledProductListItem]:
    # What the purchase form's product field offers before it falls back to
    # creating one. Narrowed to live unbilled products here rather than
    # filtered out of get_product_details on the client, so a line can never
    # be pointed at a billed product by accident.
    products = await ProductDetails.find(
        ProductDetails.is_unbilled == True,  # noqa: E712 — Beanie needs the comparison, not `is True`
        ProductDetails.is_deleted == False,  # noqa: E712
    ).to_list()

    return [
        UnbilledProductListItem(
            id=product.id, product_name=product.product_name, vendor_rate=product.vendor_rate
        )
        for product in products
    ]


@router.get("/get_unbilled_purchase_order_details", response_model=list[UnbilledPurchaseOrderDetailItem])
async def get_unbilled_purchase_order_details(
    _: User | None = Depends(require_admin),
) -> list[UnbilledPurchaseOrderDetailItem]:
    orders = await UnbilledPurchaseOrders.find_all().to_list()
    if not orders:
        return []

    order_ids = [order.id for order in orders]
    summaries = await UnbilledPurchaseSummary.find(
        In(UnbilledPurchaseSummary.unbilled_purchase_order_id, order_ids)
    ).to_list()
    summaries_by_order_id: dict[int, list[UnbilledPurchaseSummary]] = {}
    for summary in summaries:
        summaries_by_order_id.setdefault(summary.unbilled_purchase_order_id, []).append(summary)

    # Product names are resolved here rather than on the client: these
    # products are created by this module and are filtered out of the
    # storefront and the billed pickers, so the list would have nothing to
    # join against on its own.
    products = await ProductDetails.find(
        In(ProductDetails.id, [summary.product_id for summary in summaries])
    ).to_list()
    product_names_by_id = {product.id: product.product_name for product in products}

    response = []
    for order in orders:
        line_items = summaries_by_order_id.get(order.id, [])
        response.append(
            UnbilledPurchaseOrderDetailItem(
                id=order.id,
                purchase_order_no=order.purchase_order_no,
                vendor_id=order.vendor_id,
                date=order.date,
                product_ids=[item.product_id for item in line_items],
                product_names=[
                    product_names_by_id.get(item.product_id, f"Product {item.product_id}")
                    for item in line_items
                ],
                quantities=[item.quantity for item in line_items],
                rates=[item.rate for item in line_items],
                total_amount=order.total_amount,
                description=order.description,
            )
        )

    return response


@router.post(
    "/update_unbilled_purchase_order_details", response_model=UpdateUnbilledPurchaseOrderDetailsResponse
)
async def update_unbilled_purchase_order_details(
    payload: UpdateUnbilledPurchaseOrderDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateUnbilledPurchaseOrderDetailsResponse:
    unbilled_purchase_order = await UnbilledPurchaseOrders.get(payload.id)
    if unbilled_purchase_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unbilled purchase order not found")

    await _get_vendor_or_404(payload.vendor_id)

    # Resolved without creating, so the stock check below runs before any
    # product row is written and a rejected edit leaves nothing behind.
    resolved = await _resolve_existing_products(payload.product_ids, payload.product_names, reject_deleted=False)
    applied = await get_applied_unbilled_purchase_quantities(unbilled_purchase_order.id)

    # Checked against the lines whose product already exists. A line whose
    # product is about to be created can only ADD stock — nothing on hand,
    # nothing applied — so it can never be the reason a delta goes negative,
    # which is what makes it safe to run this check before creating them.
    known_ids = [product_id for product_id in resolved if product_id is not None]
    known_quantities = [
        quantity for product_id, quantity in zip(resolved, payload.quantities) if product_id is not None
    ]
    await _reject_stock_going_negative(
        compute_stock_deltas(applied, totals_by_product(known_ids, known_quantities), STOCK_IN)
    )

    product_ids = await _create_missing_products(
        resolved, payload.product_names, payload.rates, payload.vendor_id
    )
    stock_deltas = compute_stock_deltas(applied, totals_by_product(product_ids, payload.quantities), STOCK_IN)

    unbilled_purchase_order.vendor_id = payload.vendor_id
    unbilled_purchase_order.date = payload.date
    unbilled_purchase_order.total_amount = _compute_total(payload.quantities, payload.rates)
    unbilled_purchase_order.description = payload.description
    # purchase_order_no is never reassigned — it is derived from the id.
    await unbilled_purchase_order.save()

    await UnbilledPurchaseSummary.find(
        UnbilledPurchaseSummary.unbilled_purchase_order_id == unbilled_purchase_order.id
    ).delete()
    await _insert_summary_rows(unbilled_purchase_order.id, product_ids, payload.quantities, payload.rates)
    await apply_unbilled_purchase_order_stock(
        unbilled_purchase_order.id, product_ids, payload.quantities, stock_deltas
    )
    await _flag_related_sales_orders(unbilled_purchase_order.id)

    return UpdateUnbilledPurchaseOrderDetailsResponse(message="unbilled purchase order updated successfully")
