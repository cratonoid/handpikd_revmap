// ---------------------------------------------------------------------------
// <DashboardModulePage> — heading + "not wired up yet" placeholder
// ---------------------------------------------------------------------------
// Every admin/customer module route (Clients, Orders, Inventory, ...) renders
// this same shape until its real API/UI is built — one heading component
// instead of each page.tsx duplicating the same markup. Distinct from
// components/coming-soon.tsx, which renders a full Header/Footer page shell;
// this one only fills the <DashboardShell>'s content area.
import styles from "@/styles/dashboard.module.css";

export function DashboardModulePage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <h1 className={styles.pageHeading}>{title}</h1>
      <p className={styles.pageSubtext}>{description}</p>
      {children ?? (
        <div className={styles.placeholderCard}>
          <p className={styles.placeholderHeading}>Module coming soon</p>
          <p className={styles.placeholderBlurb}>
            This section will connect to its API next. For now it&apos;s a placeholder in the dashboard layout.
          </p>
        </div>
      )}
    </>
  );
}
