// Route: "/admin" — the "Analytical Dashboard" nav item's landing page.
import type { Metadata } from "next";
import styles from "@/styles/dashboard.module.css";

export const metadata: Metadata = {
  title: "Analytical Dashboard",
};

const STATS = [
  { label: "Total Clients", value: "—" },
  { label: "Open Orders", value: "—" },
  { label: "Inventory Items", value: "—" },
  { label: "Pending Quotations", value: "—" },
  { label: "Unpaid Invoices", value: "—" },
];

export default function AdminDashboardPage() {
  return (
    <>
      <h1 className={styles.pageHeading}>Analytical Dashboard</h1>
      <p className={styles.pageSubtext}>
        A snapshot of clients, orders, inventory, and finances across the business. Figures will populate once each
        module is connected to its API.
      </p>
      <div className={styles.statGrid}>
        {STATS.map((stat) => (
          <div key={stat.label} className={styles.statCard}>
            <p className={styles.statLabel}>{stat.label}</p>
            <p className={styles.statValue}>{stat.value}</p>
          </div>
        ))}
      </div>
    </>
  );
}
