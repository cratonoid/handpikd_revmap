# Schema for the #expense_details collection: hand-entered out-of-pocket
# expenses recorded on the admin's /admin/accounts page (frontend
# components/admin/accounts-expenses-tab.tsx). Deliberately minimal — a name,
# an amount and whether the money has come back — with no link to any order,
# invoice or vendor; these are the odd spends (courier, fuel, a tip) that
# don't belong on a purchase invoice.
from datetime import datetime, timezone
from enum import Enum

from beanie import Document
from pydantic import Field


# `paid` means the money went out of someone's pocket and is still owed back
# to them; `reimbursed` means it has been settled. There is no "unpaid" —
# an expense is only recorded once it has actually been spent.
class ExpenseStatus(str, Enum):
    paid = "paid"
    reimbursed = "reimbursed"


class ExpenseDetails(Document):
    id: int
    expense_name: str
    amount: float
    status: ExpenseStatus = ExpenseStatus.paid
    # The day the expense was incurred, entered by the admin (midnight, no
    # time component — same treatment as QuotationDetails.date). This is what
    # the table orders by and what the overview's P&L buckets it into. Rows
    # from before the field existed take their created_at, see
    # _backfill_expense_dates in core/db.py.
    date: datetime
    # Stamped server-side on insert.
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    class Settings:
        name = "expense_details"
