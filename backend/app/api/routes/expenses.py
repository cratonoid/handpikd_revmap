# Expenses module: endpoints for the hand-entered expense list on the admin's
# /admin/accounts page (frontend components/admin/accounts-expenses-tab.tsx),
# restricted to admins (bypassed entirely when settings.auth_enabled is
# False, matching require_admin in routes/admin.py).
#
# Unlike the rest of the accounts module (routes/accounts.py), which only
# derives figures from collections other modules maintain, this one owns its
# own collection: an expense has no order or invoice behind it, so there is
# nothing to derive it from. It is kept out of the P&L on purpose — see
# ExpenseDetails in models/expense_details.py for what these rows are.
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import ExpenseDetails, ExpenseIdCounter, User
from app.schemas.expenses import (
    AddExpenseRequest,
    AddExpenseResponse,
    ExpenseItem,
    UpdateExpenseRequest,
    UpdateExpenseResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/expenses", tags=["expenses"])


def _to_item(expense: ExpenseDetails) -> ExpenseItem:
    return ExpenseItem(
        expense_id=expense.id,
        expense_name=expense.expense_name,
        amount=expense.amount,
        status=expense.status,
        date=expense.date.date(),
        created_at=expense.created_at,
    )


def _at_midnight(value: date) -> datetime:
    # Date-only on the wire, stored as a naive midnight datetime so it sorts
    # and range-filters alongside the invoice/order dates the overview uses.
    return datetime.combine(value, datetime.min.time())


@router.get("/get_expenses", response_model=list[ExpenseItem])
async def get_expenses(
    _: User | None = Depends(require_admin),
) -> list[ExpenseItem]:
    # Newest first by the entered date, with id breaking ties within a day
    # so the row added last sits on top (the same rule lib/row-order.ts
    # applies to every other list).
    expenses = await ExpenseDetails.find_all().sort(-ExpenseDetails.date, -ExpenseDetails.id).to_list()
    return [_to_item(expense) for expense in expenses]


@router.post("/add_expense", response_model=AddExpenseResponse)
async def add_expense(
    payload: AddExpenseRequest,
    _: User | None = Depends(require_admin),
) -> AddExpenseResponse:
    expense_name = payload.expense_name.strip()
    if not expense_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expense name is required")

    expense_id = await get_next_id(ExpenseIdCounter, "next_expense_id", ExpenseDetails)
    expense = ExpenseDetails(
        id=expense_id,
        expense_name=expense_name,
        amount=payload.amount,
        status=payload.status,
        date=_at_midnight(payload.date),
    )
    await expense.insert()

    # The created row is returned so the table can show it straight away
    # instead of re-fetching the whole list for one insert.
    return AddExpenseResponse(message="expense added successfully", expense=_to_item(expense))


@router.post("/update_expense", response_model=UpdateExpenseResponse)
async def update_expense(
    payload: UpdateExpenseRequest,
    _: User | None = Depends(require_admin),
) -> UpdateExpenseResponse:
    expense = await ExpenseDetails.get(payload.expense_id)
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="expense not found")

    if payload.delete:
        await expense.delete()
        return UpdateExpenseResponse(message="expense deleted successfully")

    changed = False
    if payload.expense_name is not None:
        expense_name = payload.expense_name.strip()
        if not expense_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expense name is required")
        expense.expense_name = expense_name
        changed = True
    if payload.amount is not None:
        expense.amount = payload.amount
        changed = True
    if payload.status is not None:
        expense.status = payload.status
        changed = True
    if payload.date is not None:
        expense.date = _at_midnight(payload.date)
        changed = True

    if not changed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no changes specified")

    await expense.save()
    return UpdateExpenseResponse(message="expense updated successfully")
