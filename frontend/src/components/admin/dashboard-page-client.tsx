"use client";

// ---------------------------------------------------------------------------
// <DashboardPageClient> — the interactive body of /admin
// ---------------------------------------------------------------------------
// Fetches GET /admin/get_dashboard_stats (backend/app/api/routes/
// analytics.py) on mount and populates the stat grid. Same
// loading-falls-back-to-empty pattern as invoices-tab.tsx etc — a failed
// fetch just leaves the cards showing "—" rather than an error screen.
import { useEffect, useState } from "react";
import { fetchDashboardStats, type DashboardStats } from "@/lib/analytics";
import styles from "@/styles/dashboard.module.css";

const PLACEHOLDER = "—";

export function DashboardPageClient() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchDashboardStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        // Leave the cards at their "—" placeholder on a failed fetch (e.g.
        // the backend being unreachable) rather than showing an error.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const STATS = [
    { label: "Total Clients", value: stats?.totalClients },
    { label: "Open Orders", value: stats?.openOrders },
    { label: "Pending Quotations", value: stats?.pendingQuotations },
    { label: "Unpaid Invoices", value: stats?.unpaidInvoices },
  ];

  return (
    <>
      <h1 className={styles.pageHeading}>Analytical Dashboard</h1>
      <p className={styles.pageSubtext}>
        A snapshot of clients, orders, quotations, and invoices across the business.
      </p>
      <div className={styles.statGrid}>
        {STATS.map((stat) => (
          <div key={stat.label} className={styles.statCard}>
            <p className={styles.statLabel}>{stat.label}</p>
            <p className={styles.statValue}>{stat.value ?? PLACEHOLDER}</p>
          </div>
        ))}
      </div>
    </>
  );
}
