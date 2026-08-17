"use client";

// ---------------------------------------------------------------------------
// <InvoicesPageClient> — the interactive half of /admin/invoices
// ---------------------------------------------------------------------------
// Splits the module into two tabs: "Sales invoices" (components/admin/
// invoices-tab.tsx — table + Standard/Proforma view toggle) and "Purchase
// invoices" (components/admin/purchase-invoices-tab.tsx). Copies
// orders-page-client.tsx's tab pattern verbatim. Sales invoices is the
// default/first tab since it's the primary day-to-day workflow.
import { useState } from "react";
import { InvoicesTab } from "@/components/admin/invoices-tab";
import { PurchaseInvoicesTab } from "@/components/admin/purchase-invoices-tab";
import styles from "@/styles/dashboard.module.css";

type Tab = "sales" | "purchase";

export function InvoicesPageClient() {
  const [tab, setTab] = useState<Tab>("sales");

  return (
    <>
      <h1 className={styles.pageHeading}>Invoices</h1>

      <div className={styles.invoicesToolbar}>
        <p className={styles.pageSubtext}>Generate, send, and track payment status of sales and purchase invoices.</p>

        <div className={styles.viewToggle} role="tablist" aria-label="Invoices section">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sales"}
            onClick={() => setTab("sales")}
            className={`${styles.viewToggleButton} ${tab === "sales" ? styles.viewToggleButtonActive : ""}`}
          >
            Sales invoices
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "purchase"}
            onClick={() => setTab("purchase")}
            className={`${styles.viewToggleButton} ${tab === "purchase" ? styles.viewToggleButtonActive : ""}`}
          >
            Purchase invoices
          </button>
        </div>
      </div>

      {tab === "sales" ? <InvoicesTab /> : <PurchaseInvoicesTab />}
    </>
  );
}
