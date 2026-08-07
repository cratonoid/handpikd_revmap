"use client";

// ---------------------------------------------------------------------------
// <InventoryPageClient> — the interactive half of /admin/inventory
// ---------------------------------------------------------------------------
// Mirrors orders-page-client.tsx's two-tab split: "Inventory" (components/
// admin/inventory-tab.tsx — current stock per product) and "Inventory
// history" (components/admin/inventory-history-tab.tsx — the purchase/sale
// ledger). Inventory is the default/first tab since "what do we have right
// now" is the more common question than "how did we get here".
import { useState } from "react";
import { InventoryHistoryTab } from "@/components/admin/inventory-history-tab";
import { InventoryTab } from "@/components/admin/inventory-tab";
import styles from "@/styles/dashboard.module.css";

type Tab = "inventory" | "history";

export function InventoryPageClient() {
  const [tab, setTab] = useState<Tab>("inventory");

  return (
    <>
      <h1 className={styles.pageHeading}>Inventory</h1>
      <p className={styles.pageSubtext}>Monitor stock levels across products and warehouses.</p>

      <div className={styles.viewToggle} role="tablist" aria-label="Inventory section">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inventory"}
          onClick={() => setTab("inventory")}
          className={`${styles.viewToggleButton} ${tab === "inventory" ? styles.viewToggleButtonActive : ""}`}
        >
          Inventory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
          className={`${styles.viewToggleButton} ${tab === "history" ? styles.viewToggleButtonActive : ""}`}
        >
          Inventory history
        </button>
      </div>

      {tab === "inventory" ? <InventoryTab /> : <InventoryHistoryTab />}
    </>
  );
}
