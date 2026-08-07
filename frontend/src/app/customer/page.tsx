// Route: "/customer" — the "Dashboard" nav item's landing page.
import type { Metadata } from "next";
import styles from "@/styles/dashboard.module.css";

export const metadata: Metadata = {
  title: "Dashboard",
};

const STATS = [
  { label: "Open Orders", value: "—" },
  { label: "Completed Orders", value: "—" },
];

export default function CustomerDashboardPage() {
  return (
    <>
      <h1 className={styles.pageHeading}>Dashboard</h1>
      <p className={styles.pageSubtext}>
        A quick look at your account and order activity. Figures will populate once this is connected to the API.
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
