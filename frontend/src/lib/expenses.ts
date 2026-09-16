// ---------------------------------------------------------------------------
// Expenses — the hand-entered expense list on /admin/accounts
// ---------------------------------------------------------------------------
// Backed by /admin/expenses/* (backend/app/api/routes/expenses.py). Unlike
// the rest of lib/accounts.ts, whose figures are derived server-side, these
// rows are written by the admin — so this module has savers as well as a
// fetcher.
//
// Four fields and nothing else: what it was, what it cost, when, and whether
// the money has come back yet. "paid" is out of pocket and still owed;
// "reimbursed" is settled. `date` is a plain "YYYY-MM-DD" both ways, like the
// quotation dates (see lib/datetime-input.ts's date-only helpers).
import { apiFetch } from "@/lib/api";

export type ExpenseStatus = "paid" | "reimbursed";

export type Expense = {
  id: number;
  expenseName: string;
  amount: number;
  status: ExpenseStatus;
  date: string;
  createdAt: string;
};

export type NewExpense = {
  expenseName: string;
  amount: number;
  status: ExpenseStatus;
  date: string;
};

// Shape returned by the backend's ExpenseItem schema.
type ExpenseItemResponse = {
  expense_id: number;
  expense_name: string;
  amount: number;
  status: ExpenseStatus;
  date: string;
  created_at: string;
};

function toExpense(item: ExpenseItemResponse): Expense {
  return {
    id: item.expense_id,
    expenseName: item.expense_name,
    amount: item.amount,
    status: item.status,
    date: item.date,
    createdAt: item.created_at,
  };
}

async function detailOr(response: Response, fallback: string): Promise<string> {
  const body: { detail?: unknown } = await response.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

// Newest first by date (then id), as sorted by the backend.
export async function fetchExpenses(): Promise<Expense[]> {
  const response = await apiFetch("/admin/expenses/get_expenses");
  if (!response.ok) {
    throw new Error("Failed to load expenses.");
  }
  const items: ExpenseItemResponse[] = await response.json();
  return items.map(toExpense);
}

// Returns the created row so the table can show it without a re-fetch.
// Throws an Error with a user-facing message on failure.
export async function addExpense(payload: NewExpense): Promise<Expense> {
  const response = await apiFetch("/admin/expenses/add_expense", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expense_name: payload.expenseName,
      amount: payload.amount,
      status: payload.status,
      date: payload.date,
    }),
  });

  if (!response.ok) {
    throw new Error(await detailOr(response, "Something went wrong. Please try again."));
  }
  const body: { expense: ExpenseItemResponse } = await response.json();
  return toExpense(body.expense);
}

// Resolves to null on success or a user-facing error message on failure —
// the same shape as updateInvoiceStatus in lib/invoices.ts, since the table
// applies the change optimistically and only needs to know whether to roll
// it back.
export async function updateExpenseStatus(id: number, status: ExpenseStatus): Promise<string | null> {
  try {
    const response = await apiFetch("/admin/expenses/update_expense", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expense_id: id, status }),
    });
    if (response.ok) {
      return null;
    }
    return detailOr(response, "Couldn't update the status. Please try again.");
  } catch {
    return "Couldn't reach the server. Please try again.";
  }
}

// Throws an Error with a user-facing message on failure.
export async function deleteExpense(id: number): Promise<void> {
  const response = await apiFetch("/admin/expenses/update_expense", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expense_id: id, delete: true }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Expense not found.");
    }
    throw new Error("Something went wrong. Please try again.");
  }
}
