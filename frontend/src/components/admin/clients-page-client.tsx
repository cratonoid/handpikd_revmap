"use client";

// ---------------------------------------------------------------------------
// <ClientsPageClient> — the interactive half of /admin/clients
// ---------------------------------------------------------------------------
// Owns the customer table (fetched from GET /admin/get_customer_details, see
// lib/customers.ts) and the add/edit popup (components/admin/customer-form-
// modal.tsx). Clicking "+ Add new customer" opens the popup in "add" mode;
// clicking an existing row opens it in "edit" mode, pre-filled with that
// row's data. Both modes save through the same modal, which POSTs to
// add_customer_details / update_customer_details (backend/app/api/routes/
// admin.py) respectively.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CustomerFormModal } from "@/components/admin/customer-form-modal";
import { fetchCustomers, type Customer } from "@/lib/customers";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; customer: Customer } | null;
type LoadState = "loading" | "loaded" | "error";

export function ClientsPageClient() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);

  useEffect(() => {
    let cancelled = false;

    fetchCustomers()
      .then((data) => {
        if (cancelled) return;
        setCustomers(data);
        setLoadState("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(customer: Customer) {
    setCustomers((prev) => {
      const index = prev.findIndex((c) => c.mail === customer.mail);
      if (index === -1) {
        return [...prev, customer];
      }
      const next = [...prev];
      next[index] = customer;
      return next;
    });
    setModalState(null);
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Clients</h1>
          <p className={styles.pageSubtext}>View and manage client accounts and their points of contact.</p>
        </div>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + Add new customer
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Customer</th>
              <th className={styles.tableHeadCell}>GST number</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer, index) => (
              <tr
                key={customer.mail}
                onClick={() => setModalState({ mode: "edit", customer })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{customer.registeredName}</td>
                <td className={styles.tableCell}>{customer.companyGst}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading customers…</p>}
        {loadState === "error" && <p className={styles.formError}>Couldn't load customers. Please try again.</p>}
        {loadState === "loaded" && customers.length === 0 && (
          <p className={styles.pageSubtext}>No customers yet.</p>
        )}
      </div>

      {modalState && (
        <CustomerFormModal
          mode={modalState.mode}
          initialCustomer={modalState.mode === "edit" ? modalState.customer : undefined}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
