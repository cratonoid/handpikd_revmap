"use client";

// ---------------------------------------------------------------------------
// <AccountsExpensesTab> — the "expenses" tab of /admin/accounts
// ---------------------------------------------------------------------------
// The one tab on the accounts page that is written to rather than reported
// from: a four-field entry form (name, amount, date, paid/reimbursed) over a
// table of everything entered so far. Backed by /admin/expenses/* via
// lib/expenses.ts.
//
// It ignores the page's date range on purpose: the whole list is short
// enough to show in full, and filtering it would hide the rows an admin is
// most likely looking for (an old one entered under the wrong date, say).
// The page hides the range bar while this tab is open for the same reason
// (see accounts-page-client.tsx). The Overview tab does range over them,
// by their date: every row here comes off gross profit there, whatever its
// status.
//
// Status is changed from the table itself through the same <StatusSelect>
// the invoices table uses, applied optimistically and rolled back if the
// backend refuses. Deleting asks once inline, the way the edit modals do.
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { StatusSelect } from "@/components/admin/status-select";
import { formatCurrencyExact } from "@/lib/accounts";
import { nowAsDateValue } from "@/lib/datetime-input";
import { formatDate } from "@/lib/format-date";
import {
  addExpense,
  deleteExpense,
  fetchExpenses,
  updateExpenseStatus,
  type Expense,
  type ExpenseStatus,
} from "@/lib/expenses";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "error";

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  paid: "Paid",
  reimbursed: "Reimbursed",
};

// Ochre while the money is still owed back to whoever paid, green once it's
// settled — the same reading the invoices table gives unpaid/paid.
const STATUS_COLOR: Record<ExpenseStatus, string> = {
  paid: styles.statusProcessing,
  reimbursed: styles.statusCompleted,
};

const STATUS_OPTIONS: readonly { value: ExpenseStatus; label: string }[] = [
  { value: "paid", label: STATUS_LABEL.paid },
  { value: "reimbursed", label: STATUS_LABEL.reimbursed },
];

// The backend's order (see get_expenses), reapplied after an insert. Dates
// are plain "YYYY-MM-DD" so a string compare is a date compare.
function byNewestDateFirst(a: Expense, b: Expense): number {
  return b.date.localeCompare(a.date) || b.id - a.id;
}

export function AccountsExpensesTab() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  // The entry form. Amount is held as the raw string the input holds so a
  // half-typed "12." isn't rounded out from under the admin.
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(nowAsDateValue);
  const [status, setStatus] = useState<ExpenseStatus>("paid");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [statusSavingId, setStatusSavingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchExpenses()
      .then((rows) => {
        if (cancelled) return;
        setExpenses(rows);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Failed to load expenses.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const parsedAmount = Number(amount);
    if (!trimmedName) {
      setFormError("Enter what the expense was for.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }
    if (!date) {
      setFormError("Pick the date of the expense.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const created = await addExpense({
        expenseName: trimmedName,
        amount: parsedAmount,
        status,
        date,
      });
      // Slotted by date rather than pushed to the top, so an expense entered
      // for last month lands among last month's rows the way it would after
      // a reload. The date is left as it was: the next entry is usually from
      // the same day.
      setExpenses((current) => [...current, created].sort(byNewestDateFirst));
      setName("");
      setAmount("");
      setStatus("paid");
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(expense: Expense, nextStatus: ExpenseStatus) {
    if (nextStatus === expense.status) return;

    const previousStatus = expense.status;
    const applyStatus = (value: ExpenseStatus) =>
      setExpenses((current) =>
        current.map((row) => (row.id === expense.id ? { ...row, status: value } : row)),
      );

    setRowError(null);
    setStatusSavingId(expense.id);
    applyStatus(nextStatus);

    const error = await updateExpenseStatus(expense.id, nextStatus);

    setStatusSavingId(null);
    if (error) {
      applyStatus(previousStatus);
      setRowError(error);
    }
  }

  async function handleDelete(expense: Expense) {
    setRowError(null);
    setDeletingId(expense.id);
    try {
      await deleteExpense(expense.id);
      setExpenses((current) => current.filter((row) => row.id !== expense.id));
      setConfirmingDeleteId(null);
    } catch (caught) {
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const totalAmount = expenses.reduce((sum, row) => sum + row.amount, 0);
  const awaitingRows = expenses.filter((row) => row.status === "paid");
  const awaitingAmount = awaitingRows.reduce((sum, row) => sum + row.amount, 0);
  const reimbursedAmount = totalAmount - awaitingAmount;

  return (
    <>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Total expenses</p>
          <p className={styles.statValue}>{formatCurrencyExact(totalAmount)}</p>
          <p className={styles.accountsStatCaption}>
            {expenses.length} {expenses.length === 1 ? "entry" : "entries"}
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Awaiting reimbursement</p>
          <p className={`${styles.statValue} ${awaitingAmount > 0 ? styles.accountsNegative : ""}`}>
            {formatCurrencyExact(awaitingAmount)}
          </p>
          <p className={styles.accountsStatCaption}>{awaitingRows.length} marked paid</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Reimbursed</p>
          <p className={`${styles.statValue} ${reimbursedAmount > 0 ? styles.accountsPositive : ""}`}>
            {formatCurrencyExact(reimbursedAmount)}
          </p>
          <p className={styles.accountsStatCaption}>{expenses.length - awaitingRows.length} settled</p>
        </div>
      </div>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Add expense</h2>
        <form onSubmit={handleSubmit} className={styles.expenseForm} noValidate>
          <div className={styles.expenseFormFields}>
            <label className={styles.expenseFormField}>
              <span className={styles.formLabel}>
                Expense name<span className={styles.requiredMark}>*</span>
              </span>
              <input
                type="text"
                required
                placeholder="e.g. Courier to Bangalore"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </label>
            <label className={styles.expenseFormField}>
              <span className={styles.formLabel}>
                Amount (₹)<span className={styles.requiredMark}>*</span>
              </span>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </label>
            <label className={styles.expenseFormField}>
              <span className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </span>
              <input
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </label>
            <label className={styles.expenseFormField}>
              <span className={styles.formLabel}>Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as ExpenseStatus)}
                className={styles.formInput}
                disabled={saving}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.expenseFormSubmit}>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Adding…" : "Add expense"}
              </Button>
            </div>
          </div>
          {formError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {formError}
            </p>
          )}
        </form>
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Expenses</h2>
        {rowError && (
          <p role="alert" aria-live="polite" className={styles.formError}>
            {rowError}
          </p>
        )}
        {loadState === "loading" ? (
          <p className={styles.accountsLoading}>Loading…</p>
        ) : loadState === "error" ? (
          <p className={styles.formError}>{loadError}</p>
        ) : expenses.length === 0 ? (
          <p className={styles.accountsChartEmpty}>No expenses entered yet. Add the first one above.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCellSerial}>#</th>
                  <th className={styles.tableHeadCell}>Expense</th>
                  <th className={styles.tableHeadCellTight}>Date</th>
                  <th className={styles.tableHeadCellTight}>Amount</th>
                  <th className={styles.tableHeadCellTight}>Status</th>
                  <th className={styles.tableHeadCellTight}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense, index) => (
                  <tr key={expense.id} className={styles.tableRow}>
                    {/* Numbered down from the count so a new row takes the
                        next number at the top — see lib/row-order.ts. */}
                    <td className={styles.tableCellSerial}>{expenses.length - index}</td>
                    <td className={styles.tableCellPrimary}>{expense.expenseName}</td>
                    <td className={styles.tableCellTight}>{formatDate(expense.date)}</td>
                    <td className={styles.tableCellTight}>{formatCurrencyExact(expense.amount)}</td>
                    <td
                      className={`${styles.tableCellTight} ${styles.statusText} ${STATUS_COLOR[expense.status]}`}
                    >
                      <StatusSelect
                        value={expense.status}
                        options={STATUS_OPTIONS}
                        label={`Status for expense ${expense.expenseName}`}
                        disabled={statusSavingId === expense.id}
                        onChange={(nextStatus) => void handleStatusChange(expense, nextStatus)}
                      />
                    </td>
                    <td className={styles.tableCellTight}>
                      {confirmingDeleteId === expense.id ? (
                        <div className={styles.deleteConfirmRow}>
                          <span className={styles.deleteConfirmText}>Delete?</span>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            disabled={deletingId === expense.id}
                            className={styles.expenseRowButton}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(expense)}
                            disabled={deletingId === expense.id}
                            className={`${styles.expenseRowButton} ${styles.expenseRowButtonDanger}`}
                          >
                            {deletingId === expense.id ? "Deleting…" : "Yes, delete"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(expense.id)}
                          className={`${styles.expenseRowButton} ${styles.expenseRowButtonDanger}`}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.accountsFootnote}>
          Every expense here is deducted from gross profit on the Overview tab, in the month of its date.
          Status only tracks whether whoever paid has been paid back.
        </p>
      </section>
    </>
  );
}
