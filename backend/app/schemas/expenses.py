# Request/response bodies for the expenses module's endpoints.
# `date` is imported under another name because it is also a field name
# below: in `date: date | None = None` Python binds the default to `date` in
# the class body before it evaluates the annotation, which would then read
# `None | None`.
from datetime import date as calendar_date
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.expense_details import ExpenseStatus


class ExpenseItem(BaseModel):
    expense_id: int
    expense_name: str
    amount: float
    status: ExpenseStatus
    date: calendar_date
    created_at: datetime


class AddExpenseRequest(BaseModel):
    expense_name: str = Field(min_length=1)
    amount: float = Field(gt=0)
    status: ExpenseStatus = ExpenseStatus.paid
    date: calendar_date


class AddExpenseResponse(BaseModel):
    message: str
    expense: ExpenseItem


# Any subset of the four editable fields, or `delete` on its own — a
# request carrying neither is rejected as "no changes specified" (see
# update_expense in routes/expenses.py).
class UpdateExpenseRequest(BaseModel):
    expense_id: int
    expense_name: str | None = Field(default=None, min_length=1)
    amount: float | None = Field(default=None, gt=0)
    status: ExpenseStatus | None = None
    date: calendar_date | None = None
    delete: bool = False


class UpdateExpenseResponse(BaseModel):
    message: str
