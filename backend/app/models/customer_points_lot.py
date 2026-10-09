# Schema for the #customer_points_lot collection: a client's loyalty points,
# one row per grant.
#
# Points are held as separate lots rather than one running balance on
# CustomerDetails because every grant carries its own expiry — 50 points
# added by hand today and 120 earned off an invoice last week lapse on
# different days, and a single number can't say which part of it is about
# to go. A client's balance is the sum of points - used over their live lots
# (see services/customer_points.py).
#
# A lot is never zeroed in place when it expires: it just stops counting
# once its expiry date is reached, so the history of what was granted, spent
# and lapsed stays readable on the client's form.
#
# One point is worth one rupee off a sales order.
from datetime import datetime
from enum import Enum

from beanie import Document


class PointsSource(str, Enum):
    # Added by an admin from the client form (including starting points on a
    # new client).
    manual = "manual"
    # Earned automatically when a standard invoice is marked paid.
    invoice = "invoice"
    # Carried over from the single CustomerDetails.points figure that came
    # before lots existed (see _backfill_customer_points_lots in core/db.py).
    opening_balance = "opening_balance"


class CustomerPointsLot(Document):
    id: int
    cust_id: int  # FK -> CustomerDetails.id
    points: int  # As granted. Never edited afterwards.
    # Taken by sales-order redemptions (SalesOrders.points_allocations).
    # Moves back down when an order's redemption is reduced or the order is
    # deleted.
    used: int = 0
    # Midnight at the start of the expiry date: the lot counts up to the day
    # before and is worth nothing from this date on.
    expires_at: datetime
    created_at: datetime
    source: PointsSource
    # The standard invoice whose payment earned this lot (source "invoice"
    # only) — at most one lot per invoice.
    invoice_id: int | None = None  # FK -> InvoiceDetails.id
    note: str = ""
    # Withdrawn by an admin, or by its invoice going back to unpaid / being
    # voided. Whatever was already spent from it stays spent; the remainder
    # stops counting. An invoice lot is reinstated (flag cleared) if its
    # invoice is marked paid again.
    is_revoked: bool = False

    class Settings:
        name = "customer_points_lot"
