"use client";

// ---------------------------------------------------------------------------
// <CustomerPointsSection> — one client's loyalty points ledger
// ---------------------------------------------------------------------------
// Opened from the Clients page's Points view (client-points-tab.tsx). Every
// point belongs to a lot with its own expiry date (see
// lib/customer-points.ts), so this lists them rather than showing one
// editable number: the balance is whatever is left on the lots that haven't
// expired.
//
// Adding and withdrawing points save straight away through their own
// endpoints — there is no separate Save to confirm them.
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { addDaysToDateValue, nowAsDateValue } from "@/lib/datetime-input";
import { formatDate } from "@/lib/format-date";
import {
  addCustomerPoints,
  fetchCustomerPoints,
  POINTS_VALIDITY_DAYS,
  revokeCustomerPointsLot,
  type CustomerPoints,
  type PointsLot,
} from "@/lib/customer-points";
import styles from "@/styles/dashboard.module.css";

const SOURCE_LABELS: Record<PointsLot["source"], string> = {
  manual: "Added",
  invoice: "Invoice paid",
  opening_balance: "Carried over",
};

const STATUS_LABELS: Record<PointsLot["status"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Withdrawn",
  used: "Used up",
};

export function CustomerPointsSection({ custId }: { custId: number }) {
  const [points, setPoints] = useState<CustomerPoints | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [amount, setAmount] = useState("");
  const [expiresOn, setExpiresOn] = useState(() => addDaysToDateValue(nowAsDateValue(), POINTS_VALIDITY_DAYS));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Withdrawing can't be undone, so it takes a second click on the same row.
  const [confirmingLotId, setConfirmingLotId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setPoints(await fetchCustomerPoints(custId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [custId]);

  useEffect(() => {
    let cancelled = false;
    fetchCustomerPoints(custId)
      .then((loaded) => {
        if (!cancelled) setPoints(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [custId]);

  async function handleAdd() {
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      setError("Enter a whole number of points above 0.");
      return;
    }
    if (!expiresOn || expiresOn <= nowAsDateValue()) {
      setError("The expiry date has to be after today.");
      return;
    }

    setBusy(true);
    setError(null);
    const failure = await addCustomerPoints(custId, value, expiresOn, note.trim());
    if (failure) {
      setError(failure);
    } else {
      setAmount("");
      setNote("");
      setExpiresOn(addDaysToDateValue(nowAsDateValue(), POINTS_VALIDITY_DAYS));
      await reload();
    }
    setBusy(false);
  }

  async function handleRevoke(lotId: number) {
    setConfirmingLotId(null);
    setBusy(true);
    setError(null);
    const failure = await revokeCustomerPointsLot(lotId);
    if (failure) {
      setError(failure);
    } else {
      await reload();
    }
    setBusy(false);
  }

  // Enter inside these fields would otherwise submit the whole client form.
  function addOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleAdd();
    }
  }

  return (
    <div className={styles.contactsSection}>
      <div className={styles.contactsHeader}>
        <span className={styles.formLabel}>Points</span>
        <span className={styles.pointsBalance}>
          {points ? `${points.availablePoints.toLocaleString("en-IN")} available` : loadError ? "" : "Loading…"}
        </span>
      </div>

      {loadError && <p className={styles.formError}>Couldn&apos;t load this client&apos;s points.</p>}

      <div className={styles.pointsAddRow}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="Points"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          onKeyDown={addOnEnter}
          aria-label="Points to add"
          className={styles.formInput}
        />
        <input
          type="date"
          value={expiresOn}
          min={addDaysToDateValue(nowAsDateValue(), 1)}
          onChange={(e) => setExpiresOn(e.target.value)}
          onKeyDown={addOnEnter}
          aria-label="Points expire on"
          className={styles.formInput}
        />
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={addOnEnter}
          aria-label="Note"
          className={styles.formInput}
        />
        <button type="button" onClick={() => void handleAdd()} disabled={busy} className={styles.addContactButton}>
          + Add points
        </button>
      </div>
      <p className={styles.formHint}>
        Points expire on the date picked — three weeks from today unless you change it — and are worth nothing from
        that day on. Paid invoices add 5% of their total automatically.
      </p>

      {error && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {error}
        </p>
      )}

      {points && points.lots.length > 0 && (
        <div className={styles.pointsLotsWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.pointsLotsHeadCell}>Points</th>
                <th className={styles.pointsLotsHeadCell}>Left</th>
                <th className={styles.pointsLotsHeadCell}>Expires</th>
                <th className={styles.pointsLotsHeadCell}>From</th>
                <th className={styles.pointsLotsHeadCell}>Status</th>
                <th className={styles.pointsLotsHeadCell} />
              </tr>
            </thead>
            <tbody>
              {points.lots.map((lot) => (
                <tr key={lot.id} className={lot.status === "active" ? undefined : styles.pointsLotInactive}>
                  <td className={styles.pointsLotsCell}>{lot.points}</td>
                  <td className={styles.pointsLotsCell}>{lot.status === "active" ? lot.remaining : 0}</td>
                  <td className={styles.pointsLotsCell}>{formatDate(lot.expiresOn)}</td>
                  <td className={styles.pointsLotsCell} title={lot.note || undefined}>
                    {SOURCE_LABELS[lot.source]}
                    {lot.note && <span className={styles.pointsLotNote}> · {lot.note}</span>}
                  </td>
                  <td className={styles.pointsLotsCell}>{STATUS_LABELS[lot.status]}</td>
                  <td className={styles.pointsLotsCell}>
                    {lot.status === "active" && (
                      <button
                        type="button"
                        onClick={() =>
                          confirmingLotId === lot.id ? void handleRevoke(lot.id) : setConfirmingLotId(lot.id)
                        }
                        disabled={busy}
                        className={styles.linkButton}
                      >
                        {confirmingLotId === lot.id ? "Confirm withdraw" : "Withdraw"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
