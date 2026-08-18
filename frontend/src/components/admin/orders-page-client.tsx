"use client";

// ---------------------------------------------------------------------------
// <OrdersPageClient> — the interactive half of /admin/orders
// ---------------------------------------------------------------------------
// Splits the module into two tabs: "Sales orders" (components/admin/
// sales-orders-tab.tsx — table + "+ New sales order" form) and "Purchase
// orders" (components/admin/purchase-orders-tab.tsx). Sales orders is the
// default/first tab since it's the primary day-to-day workflow.
import { useState } from "react";
import { PurchaseOrdersTab } from "@/components/admin/purchase-orders-tab";
import { SalesOrdersTab } from "@/components/admin/sales-orders-tab";
import styles from "@/styles/dashboard.module.css";

type Tab = "sales" | "purchase";

export function OrdersPageClient() {
  const [tab, setTab] = useState<Tab>("sales");

  return (
    <>
      <h1 className={styles.pageHeading}>Orders</h1>

      <div className={styles.viewToggle} role="tablist" aria-label="Orders section">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sales"}
          onClick={() => setTab("sales")}
          className={`${styles.viewToggleButton} ${tab === "sales" ? styles.viewToggleButtonActive : ""}`}
        >
          Sales orders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "purchase"}
          onClick={() => setTab("purchase")}
          className={`${styles.viewToggleButton} ${tab === "purchase" ? styles.viewToggleButtonActive : ""}`}
        >
          Purchase orders
        </button>
      </div>

      {tab === "sales" ? <SalesOrdersTab /> : <PurchaseOrdersTab />}
    </>
  );
}
