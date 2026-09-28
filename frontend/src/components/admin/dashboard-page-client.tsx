"use client";

// ---------------------------------------------------------------------------
// <DashboardPageClient> — the interactive body of /admin
// ---------------------------------------------------------------------------
// Fetches GET /admin/get_dashboard_stats (backend/app/api/routes/
// analytics.py) on mount and renders: a row of headline KPI cards, a
// six-month sales bar chart, an orders-by-status donut, and the latest
// orders. Charts are plain HTML/SVG — the data is a handful of points, not
// worth a charting library. A failed fetch leaves the cards at "—" and shows
// one alert line rather than an error screen.
import { useEffect, useState, type ComponentType, type CSSProperties, type SVGProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChartBarIcon, ReceiptIcon, ShoppingCartIcon, UsersIcon } from "@/components/icons";
import {
  fetchDashboardStats,
  formatRupees,
  formatRupeesCompact,
  type DashboardStats,
  type MonthlySales,
  type OrderStatusCount,
} from "@/lib/analytics";
import { formatDate } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "failed";

const PLACEHOLDER = "—";

// Same status colors as the Orders table (see statusColors in lib/brand.ts),
// keyed by name since that's what OrderStatusMaster is seeded by.
const STATUS_COLOR_VAR: Record<string, string> = {
  New: "var(--color-status-new)",
  Processing: "var(--color-status-processing)",
  Delivered: "var(--color-status-delivered)",
  Completed: "var(--color-status-completed)",
};

const STATUS_TEXT_CLASS: Record<string, string> = {
  New: styles.statusNew,
  Processing: styles.statusProcessing,
  Delivered: styles.statusDelivered,
  Completed: styles.statusCompleted,
};

function statusColor(name: string): string {
  return STATUS_COLOR_VAR[name] ?? "var(--color-border)";
}

function monthLabel(key: string, style: "short" | "long" = "short"): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: style,
    ...(style === "long" ? { year: "numeric" } : {}),
  });
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function DashboardPageClient() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // The server's clock and the viewer's can disagree on the greeting, so the
  // two elements that show it carry suppressHydrationWarning.
  const [today] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;

    fetchDashboardStats()
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const months = stats?.monthlySales ?? [];
  const thisMonth = months.at(-1);
  const lastMonth = months.at(-2);
  const salesChange =
    thisMonth && lastMonth && lastMonth.total > 0
      ? Math.round(((thisMonth.total - lastMonth.total) / lastMonth.total) * 100)
      : null;

  return (
    <div className={styles.dash}>
      <header className={styles.dashHero}>
        <div>
          <p className={styles.dashHeroEyebrow} suppressHydrationWarning>
            {today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <h1 className={styles.dashHeroTitle} suppressHydrationWarning>
            {greetingFor(today.getHours())}
          </h1>
          <p className={styles.dashHeroSubtext}>Here&apos;s how Handpikd is doing at a glance.</p>
        </div>
        <Link href="/admin/orders" className={styles.dashHeroButton}>
          View orders
        </Link>
      </header>

      {loadState === "failed" && (
        <p role="alert" className={styles.formError}>
          Couldn&apos;t load the dashboard figures. Please refresh the page or try again shortly.
        </p>
      )}

      <div className={styles.kpiGrid}>
        <KpiCard
          featured
          href="/admin/orders"
          icon={ChartBarIcon}
          label="Sales this month"
          value={thisMonth ? formatRupees(thisMonth.total) : PLACEHOLDER}
          caption={thisMonth ? `${thisMonth.orderCount} order${thisMonth.orderCount === 1 ? "" : "s"} placed` : null}
          change={salesChange}
        />
        <KpiCard
          href="/admin/orders"
          icon={ShoppingCartIcon}
          accent="var(--color-status-processing)"
          label="Open orders"
          value={stats ? String(stats.openOrders) : PLACEHOLDER}
          caption={stats ? `${formatRupees(stats.openOrdersValue)} in the pipeline` : null}
        />
        <KpiCard
          href="/admin/invoices"
          icon={ReceiptIcon}
          accent="var(--color-red)"
          label="Outstanding"
          value={stats ? formatRupees(stats.unpaidAmount) : PLACEHOLDER}
          caption={
            stats ? `${stats.unpaidInvoices} unpaid tax invoice${stats.unpaidInvoices === 1 ? "" : "s"}` : null
          }
        />
        <KpiCard
          href="/admin/clients"
          icon={UsersIcon}
          accent="var(--color-status-new)"
          label="Clients"
          value={stats ? String(stats.totalClients) : PLACEHOLDER}
          caption={stats ? "Active client accounts" : null}
        />
      </div>

      <div className={styles.chartGrid}>
        <section className={styles.chartCard} aria-labelledby="sales-chart-title">
          <div className={styles.chartCardHeader}>
            <div>
              <h2 id="sales-chart-title" className={styles.chartCardTitle}>
                Sales
              </h2>
              <p className={styles.chartCardSubtitle}>Order value, last 6 months (incl. tax)</p>
            </div>
            {stats && (
              <p className={styles.chartCardTotal}>
                {formatRupees(months.reduce((sum, month) => sum + month.total, 0))}
                <span>6-month total</span>
              </p>
            )}
          </div>
          {stats ? <SalesBarChart months={months} /> : <div className={styles.chartSkeleton} />}
        </section>

        <section className={styles.chartCard} aria-labelledby="status-chart-title">
          <div className={styles.chartCardHeader}>
            <div>
              <h2 id="status-chart-title" className={styles.chartCardTitle}>
                Orders by status
              </h2>
              <p className={styles.chartCardSubtitle}>All orders on the books</p>
            </div>
          </div>
          {stats ? <StatusDonut rows={stats.ordersByStatus} /> : <div className={styles.chartSkeleton} />}
        </section>
      </div>

      <section className={styles.chartCard} aria-labelledby="recent-orders-title">
        <div className={styles.chartCardHeader}>
          <div>
            <h2 id="recent-orders-title" className={styles.chartCardTitle}>
              Recent orders
            </h2>
            <p className={styles.chartCardSubtitle}>The latest five, newest first</p>
          </div>
          <Link href="/admin/orders" className={styles.linkButton}>
            View all orders
          </Link>
        </div>
        <RecentOrdersTable stats={stats} loadState={loadState} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

type KpiCardProps = {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  caption: string | null;
  accent?: string;
  featured?: boolean;
  change?: number | null;
};

function KpiCard({ href, icon: Icon, label, value, caption, accent, featured, change }: KpiCardProps) {
  return (
    <Link
      href={href}
      className={`${styles.kpiCard} ${featured ? styles.kpiCardFeatured : ""}`}
      style={accent ? ({ "--kpi-accent": accent } as CSSProperties) : undefined}
    >
      <div className={styles.kpiCardTop}>
        <span className={styles.kpiIcon} aria-hidden="true">
          <Icon width={20} height={20} />
        </span>
        {change != null && (
          <span className={`${styles.kpiChange} ${change >= 0 ? styles.kpiChangeUp : styles.kpiChangeDown}`}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change)}%<span className={styles.srOnly}> vs last month</span>
          </span>
        )}
      </div>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}>{value}</p>
      {caption && <p className={styles.kpiCaption}>{caption}</p>}
      {change != null && <p className={styles.kpiFootnote}>vs last month</p>}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Sales bar chart — one series, so no legend: the card title names it.
// The current month is drawn at full strength, earlier months muted.
// ---------------------------------------------------------------------------

function SalesBarChart({ months }: { months: MonthlySales[] }) {
  const max = Math.max(...months.map((month) => month.total), 0);
  if (max === 0) {
    return <p className={styles.chartEmpty}>No orders in the last six months yet.</p>;
  }

  const peakIndex = months.findIndex((month) => month.total === max);
  const lastIndex = months.length - 1;

  return (
    <div className={styles.barChart} role="list" aria-label="Monthly sales">
      {[0.5, 1].map((fraction) => (
        <div
          key={fraction}
          className={styles.barGridline}
          // The plot area is the chart minus its top padding and the month-label row.
          style={{ bottom: `calc(var(--bar-label-h) + (100% - var(--bar-label-h) - 1.5rem) * ${fraction})` }}
          aria-hidden="true"
        >
          <span>{formatRupeesCompact(max * fraction)}</span>
        </div>
      ))}
      {months.map((month, index) => {
        const heightPct = (month.total / max) * 100;
        const showLabel = index === lastIndex || index === peakIndex;
        return (
          <div
            key={month.month}
            role="listitem"
            tabIndex={0}
            className={styles.barColumn}
            aria-label={`${monthLabel(month.month, "long")}: ${formatRupees(month.total)}, ${month.orderCount} orders`}
          >
            <div className={styles.barTrack}>
              <div
                className={`${styles.bar} ${index === lastIndex ? styles.barCurrent : ""}`}
                style={{ height: `${Math.max(heightPct, month.total > 0 ? 2 : 0)}%` }}
              >
                {showLabel && month.total > 0 && (
                  <span className={styles.barValue}>{formatRupeesCompact(month.total)}</span>
                )}
              </div>
              <div className={styles.barTooltip} aria-hidden="true">
                <strong>{monthLabel(month.month, "long")}</strong>
                <span>{formatRupees(month.total)}</span>
                <span>
                  {month.orderCount} order{month.orderCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            <span className={styles.barLabel}>{monthLabel(month.month)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders-by-status donut. Hovering a segment or legend row focuses it: the
// centre switches from the grand total to that status's count.
// ---------------------------------------------------------------------------

const DONUT_RADIUS = 42;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const DONUT_GAP = 1.5; // surface gap between segments, in the SVG's units

function StatusDonut({ rows }: { rows: OrderStatusCount[] }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return <p className={styles.chartEmpty}>No orders yet.</p>;
  }

  const nonEmpty = rows.filter((row) => row.count > 0);
  const gap = nonEmpty.length > 1 ? DONUT_GAP : 0;
  const lengths = nonEmpty.map((row) => (row.count / total) * DONUT_CIRCUMFERENCE);
  const segments = nonEmpty.map((row, index) => ({
    row,
    dash: Math.max(lengths[index] - gap, 0.5),
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }));

  const active = rows.find((row) => row.statusId === activeId) ?? null;

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut}>
        <svg viewBox="0 0 100 100" role="img" aria-label="Orders by status">
          <circle cx="50" cy="50" r={DONUT_RADIUS} className={styles.donutTrack} />
          {segments.map(({ row, dash, offset: segmentOffset }) => (
            <circle
              key={row.statusId}
              cx="50"
              cy="50"
              r={DONUT_RADIUS}
              className={styles.donutSegment}
              stroke={statusColor(row.statusName)}
              strokeDasharray={`${dash} ${DONUT_CIRCUMFERENCE - dash}`}
              strokeDashoffset={-segmentOffset}
              opacity={activeId === null || activeId === row.statusId ? 1 : 0.25}
              onMouseEnter={() => setActiveId(row.statusId)}
              onMouseLeave={() => setActiveId(null)}
            >
              <title>{`${row.statusName}: ${row.count}`}</title>
            </circle>
          ))}
        </svg>
        <div className={styles.donutCentre} aria-live="polite">
          <span className={styles.donutCentreValue}>{active ? active.count : total}</span>
          <span className={styles.donutCentreLabel}>{active ? active.statusName : "Total orders"}</span>
        </div>
      </div>

      <ul className={styles.donutLegend}>
        {rows.map((row) => (
          <li
            key={row.statusId}
            className={`${styles.donutLegendRow} ${activeId === row.statusId ? styles.donutLegendRowActive : ""}`}
            onMouseEnter={() => setActiveId(row.statusId)}
            onMouseLeave={() => setActiveId(null)}
          >
            <span className={styles.donutSwatch} style={{ backgroundColor: statusColor(row.statusName) }} />
            <span className={styles.donutLegendName}>{row.statusName}</span>
            <span className={styles.donutLegendCount}>{row.count}</span>
            <span className={styles.donutLegendPct}>{Math.round((row.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent orders
// ---------------------------------------------------------------------------

function RecentOrdersTable({ stats, loadState }: { stats: DashboardStats | null; loadState: LoadState }) {
  const router = useRouter();
  const orders = stats?.recentOrders ?? [];

  return (
    <div className={styles.dashTableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.tableHeadCell}>Order no.</th>
            <th className={styles.tableHeadCell}>Client</th>
            <th className={styles.tableHeadCell}>Date</th>
            <th className={styles.tableHeadCell}>Status</th>
            <th className={`${styles.tableHeadCell} ${styles.dashAmountCell}`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className={styles.tableRow}
              onClick={() => router.push(`/admin/orders/sales/${order.id}/details`)}
            >
              <td data-card-title className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                #{order.orderNo}
              </td>
              <td data-label="Client" className={styles.tableCell}>
                {order.customerName}
              </td>
              <td data-label="Date" className={styles.tableCell}>
                {formatDate(order.date)}
              </td>
              <td data-label="Status" className={styles.tableCell}>
                <span
                  className={`${styles.statusPill} ${STATUS_TEXT_CLASS[order.statusName] ?? ""}`}
                  style={{ "--pill-color": statusColor(order.statusName) } as CSSProperties}
                >
                  {order.statusName}
                </span>
              </td>
              <td data-label="Amount" className={`${styles.tableCell} ${styles.dashAmountCell}`}>
                {formatRupees(order.totalAmountAfterTax)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {loadState === "loading" && <p className={styles.chartEmpty}>Loading orders…</p>}
      {loadState === "loaded" && orders.length === 0 && <p className={styles.chartEmpty}>No orders yet.</p>}
    </div>
  );
}
