# Client loyalty points: granting, expiring, earning off paid invoices, and
# spending on sales orders.
#
# Points live in #customer_points_lot, one row per grant with its own expiry
# (see models/customer_points_lot.py for why). The rules, all in this file:
#
#   - Every grant expires POINTS_VALIDITY (3 weeks) after it starts unless
#     the admin picks another date: from today for points added by hand, from
#     the invoice's own date for points earned off one.
#   - A lot is worth nothing from its expiry date on. Nothing has to run on
#     that day — expiry is decided whenever the balance is read.
#   - Marking a standard invoice paid earns INVOICE_REWARD_RATE (5%) of its
#     total, after tax, as points. Taking the payment back off (unpaid, or
#     voiding the invoice) withdraws whatever of them is still unspent.
#   - A sales order can spend at most MAX_REDEMPTION_RATE (5%) of its net
#     subtotal in points. Points are drawn from the lots closest to expiry
#     first, so a client never loses points that could have been spent.
#
# One point is one rupee off the order.
import math
from collections.abc import Awaitable, Callable, Iterable
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status

from app.models import (
    CustomerPointsLot,
    CustomerPointsLotIdCounter,
    InvoiceDetails,
    InvoiceStatus,
    InvoiceType,
    PointsAllocation,
    PointsSource,
)
from app.services.counters import get_next_id
from app.services.invoice_numbering import format_sales_invoice_no

POINTS_VALIDITY = timedelta(weeks=3)
INVOICE_REWARD_RATE = 0.05
MAX_REDEMPTION_RATE = 0.05

# The business runs on Indian time, and "has this expired yet" is a question
# about the calendar date there — not the server's, which may be UTC. India
# has no daylight saving, so a fixed offset is exact.
_IST = timezone(timedelta(hours=5, minutes=30))


def today() -> date:
    return datetime.now(_IST).date()


def default_expiry(start: date | None = None) -> date:
    return (start or today()) + POINTS_VALIDITY


def _expires_at(expires_on: date) -> datetime:
    # Stored as midnight because Mongo has no plain date type.
    return datetime.combine(expires_on, time.min)


def remaining_points(lot: CustomerPointsLot) -> int:
    return max(lot.points - lot.used, 0)


def is_live(lot: CustomerPointsLot, on: date) -> bool:
    return not lot.is_revoked and on < lot.expires_at.date()


def available_points(lots: Iterable[CustomerPointsLot], on: date) -> int:
    return sum(remaining_points(lot) for lot in lots if is_live(lot, on))


def _floor_points(amount: float) -> int:
    # Rounded to the paisa first so float noise (1000 * 0.05 = 50.000000001,
    # or 49.99999999) can't move a whole point either way.
    return max(math.floor(round(amount, 2)), 0)


def max_redeemable_points(net_subtotal: float) -> int:
    return _floor_points(net_subtotal * MAX_REDEMPTION_RATE)


def invoice_reward_points(total_amount_after_tax: float) -> int:
    return _floor_points(total_amount_after_tax * INVOICE_REWARD_RATE)


async def get_customer_lots(cust_id: int) -> list[CustomerPointsLot]:
    lots = await CustomerPointsLot.find(CustomerPointsLot.cust_id == cust_id).to_list()
    return sorted(lots, key=lambda lot: (lot.expires_at, lot.id))


async def grant_points(
    cust_id: int,
    points: int,
    expires_on: date,
    source: PointsSource,
    note: str = "",
    invoice_id: int | None = None,
) -> CustomerPointsLot:
    lot_id = await get_next_id(CustomerPointsLotIdCounter, "next_customer_points_lot_id", CustomerPointsLot)
    lot = CustomerPointsLot(
        id=lot_id,
        cust_id=cust_id,
        points=points,
        expires_at=_expires_at(expires_on),
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        source=source,
        invoice_id=invoice_id,
        note=note,
    )
    await lot.insert()
    return lot


# ---------------------------------------------------------------------------
# Spending points on a sales order
# ---------------------------------------------------------------------------


async def _take_from_lot(lot_id: int, points: int) -> bool:
    # Conditional on the lot still having the points, in the database rather
    # than off the copy read a moment ago, so two orders saved at once can't
    # both spend the same points.
    result = await CustomerPointsLot.get_pymongo_collection().update_one(
        {"_id": lot_id, "is_revoked": False, "$expr": {"$lte": [{"$add": ["$used", points]}, "$points"]}},
        {"$inc": {"used": points}},
    )
    return result.modified_count == 1


async def release_points(allocations: Iterable[PointsAllocation]) -> None:
    collection = CustomerPointsLot.get_pymongo_collection()
    for allocation in allocations:
        await collection.update_one({"_id": allocation.lot_id}, {"$inc": {"used": -allocation.points}})


async def _retake_points(allocations: Iterable[PointsAllocation]) -> None:
    # Puts back an allocation that was released a moment ago, when the
    # redemption replacing it failed. Unconditional: those exact points were
    # this order's until then.
    collection = CustomerPointsLot.get_pymongo_collection()
    for allocation in allocations:
        await collection.update_one({"_id": allocation.lot_id}, {"$inc": {"used": allocation.points}})


async def redeem_points(
    cust_id: int,
    points: int,
    on: date,
    reusable_lot_ids: Iterable[int] = (),
) -> list[PointsAllocation]:
    """Take `points` off the client's balance, soonest-expiring lots first.

    `reusable_lot_ids` are lots the order being saved already drew from: an
    order keeps the points it claimed while they were live, so re-saving an
    old order after one of its lots has expired doesn't strip them from it.
    """
    if points <= 0:
        return []

    reusable = set(reusable_lot_ids)
    lots = [
        lot
        for lot in await get_customer_lots(cust_id)
        if (is_live(lot, on) or (lot.id in reusable and not lot.is_revoked)) and remaining_points(lot) > 0
    ]
    total = sum(remaining_points(lot) for lot in lots)
    if points > total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"this client only has {total} points available, so {points} can't be redeemed",
        )

    allocations: list[PointsAllocation] = []
    left = points
    for lot in lots:
        if not left:
            break
        take = min(remaining_points(lot), left)
        if not await _take_from_lot(lot.id, take):
            await release_points(allocations)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="the client's points changed while this order was being saved; reload and try again",
            )
        allocations.append(PointsAllocation(lot_id=lot.id, points=take))
        left -= take
    return allocations


async def reconcile_order_points(
    current: list[PointsAllocation],
    current_cust_id: int,
    cust_id: int,
    points: int,
    on: date,
) -> list[PointsAllocation]:
    """The allocations an order should hold after an edit.

    Unchanged when the client and the amount are, so re-saving an order
    never reshuffles which lots its points came from. Otherwise the old
    points are handed back and the new amount drawn afresh — restoring the
    old ones if that fails, so a rejected edit leaves the balance as it was.
    """
    held = sum(allocation.points for allocation in current)
    if current_cust_id == cust_id and held == points:
        return current

    await release_points(current)
    reusable = [allocation.lot_id for allocation in current] if current_cust_id == cust_id else []
    try:
        return await redeem_points(cust_id, points, on, reusable)
    except HTTPException:
        await _retake_points(current)
        raise


# ---------------------------------------------------------------------------
# Earning points off a paid invoice
# ---------------------------------------------------------------------------


async def sync_invoice_reward(
    invoice: InvoiceDetails,
    resolve_cust_id: Callable[[], Awaitable[int | None]],
) -> None:
    """Make the invoice's reward lot match its payment state.

    Called after every save that can change a standard invoice's status or
    void it. Idempotent: an invoice earns one lot, ever, sized off its total
    when it was first paid. Flipping it back to unpaid (or voiding it)
    revokes that lot's unspent points, and paying it again reinstates them —
    rather than granting a second lot.

    `resolve_cust_id` is only awaited when a lot is actually created, since
    a standard invoice's client has to be looked up through its sales
    orders.
    """
    if invoice.type != InvoiceType.standard:
        return

    earns = invoice.status == InvoiceStatus.paid and not invoice.is_deleted
    lot = await CustomerPointsLot.find_one(
        CustomerPointsLot.source == PointsSource.invoice,
        CustomerPointsLot.invoice_id == invoice.id,
    )

    if earns:
        if lot is None:
            points = invoice_reward_points(invoice.total_amount_after_tax)
            cust_id = await resolve_cust_id() if points > 0 else None
            if cust_id is None:
                return
            await grant_points(
                cust_id,
                points,
                default_expiry(invoice.date.date()),
                PointsSource.invoice,
                note=f"{INVOICE_REWARD_RATE:.0%} of invoice {format_sales_invoice_no(invoice)}",
                invoice_id=invoice.id,
            )
        elif lot.is_revoked:
            lot.is_revoked = False
            await lot.save()
    elif lot is not None and not lot.is_revoked:
        lot.is_revoked = True
        await lot.save()
