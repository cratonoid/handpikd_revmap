"use client";

// ---------------------------------------------------------------------------
// Chart primitives for the accounts module
// ---------------------------------------------------------------------------
// Hand-rolled inline SVG rather than a charting library. The admin bundle has
// no chart dependency today and these two shapes — grouped columns over time,
// and a horizontal breakdown — are all three accounts tabs need; pulling in
// Recharts to draw them would cost more than it saves.
//
// Both charts are drawn into a fixed viewBox and scaled by CSS (width: 100%,
// height: auto), so a single set of coordinates works at every screen size.
// The wrapper in dashboard.module.css gives them a min-width plus horizontal
// scroll, so a phone gets a readable chart it can swipe rather than a
// crushed one it can't.
//
// Colours come from the existing --color-status-* tokens rather than new
// chart-specific ones, so the palette stays the single one the dashboard
// already uses (see the .accountsChart* rules in dashboard.module.css).
//
// Accessibility: every bar carries a <title>, which browsers surface as a
// native tooltip on hover and screen readers announce — that's what carries
// the exact figure, so the axis labels can stay compact.
import styles from "@/styles/dashboard.module.css";

// ---------------------------------------------------------------------------
// Scale helpers
// ---------------------------------------------------------------------------
// Rounds an axis maximum up to a "clean" number so gridline labels read as
// ₹5L / ₹10L rather than ₹4.87L. Returns 1 for an all-zero series so the
// chart still draws a baseline instead of dividing by zero.
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

const GRID_LINES = 4;

// ---------------------------------------------------------------------------
// Grouped column chart — one group per period, one column per series
// ---------------------------------------------------------------------------
export type ChartSeries = {
  key: string;
  label: string;
  // Maps onto a .accountsBar<Name> class in dashboard.module.css.
  tone: "revenue" | "cost" | "profit" | "overdue";
};

export type ChartGroup = {
  label: string;
  values: Record<string, number>;
};

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 300;
const PAD_LEFT = 64;
const PAD_RIGHT = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 36;

export function GroupedBarChart({
  groups,
  series,
  formatValue,
  emptyMessage = "No data in this range.",
}: {
  groups: ChartGroup[];
  series: ChartSeries[];
  formatValue: (value: number) => string;
  emptyMessage?: string;
}) {
  if (groups.length === 0) {
    return <p className={styles.accountsChartEmpty}>{emptyMessage}</p>;
  }

  const plotWidth = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;

  const maxValue = niceMax(
    Math.max(0, ...groups.flatMap((group) => series.map((entry) => group.values[entry.key] ?? 0))),
  );

  const groupWidth = plotWidth / groups.length;
  // A tenth of each slot is left as breathing room on either side of the
  // group, so neighbouring months don't visually merge.
  const barAreaWidth = groupWidth * 0.8;
  const barWidth = barAreaWidth / series.length;

  // Only every Nth label is drawn once the range gets long — twelve months
  // fit, thirty-six overlap into mush.
  const labelStride = Math.ceil(groups.length / 12);

  return (
    <div className={styles.accountsChartScroll}>
      <svg
        className={styles.accountsChartSvg}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`${series.map((entry) => entry.label).join(" and ")} by period`}
      >
        {/* Gridlines + y-axis labels, drawn first so bars sit on top. */}
        {Array.from({ length: GRID_LINES + 1 }, (_, index) => {
          const ratio = index / GRID_LINES;
          const y = PAD_TOP + plotHeight * ratio;
          return (
            <g key={index}>
              <line
                className={styles.accountsChartGrid}
                x1={PAD_LEFT}
                y1={y}
                x2={VIEW_WIDTH - PAD_RIGHT}
                y2={y}
              />
              <text className={styles.accountsChartAxisLabel} x={PAD_LEFT - 8} y={y + 4} textAnchor="end">
                {formatValue(maxValue * (1 - ratio))}
              </text>
            </g>
          );
        })}

        {groups.map((group, groupIndex) => {
          const groupStart = PAD_LEFT + groupIndex * groupWidth + (groupWidth - barAreaWidth) / 2;
          return (
            <g key={group.label}>
              {series.map((entry, seriesIndex) => {
                const value = group.values[entry.key] ?? 0;
                // Clamped at zero: these series are all non-negative, and a
                // stray negative would otherwise draw upward out of the plot.
                const height = Math.max(0, (value / maxValue) * plotHeight);
                return (
                  <rect
                    key={entry.key}
                    className={`${styles.accountsBar} ${styles[`accountsBar${capitalize(entry.tone)}`]}`}
                    x={groupStart + seriesIndex * barWidth}
                    // A visible sliver for a non-zero-but-tiny value, so a bad
                    // month reads as "almost nothing" rather than "no data".
                    y={baseline - Math.max(height, value > 0 ? 1.5 : 0)}
                    width={Math.max(barWidth - 2, 1)}
                    height={Math.max(height, value > 0 ? 1.5 : 0)}
                  >
                    <title>{`${group.label} — ${entry.label}: ${formatValue(value)}`}</title>
                  </rect>
                );
              })}
              {groupIndex % labelStride === 0 ? (
                <text
                  className={styles.accountsChartAxisLabel}
                  x={groupStart + barAreaWidth / 2}
                  y={baseline + 20}
                  textAnchor="middle"
                >
                  {group.label}
                </text>
              ) : null}
            </g>
          );
        })}

        <line
          className={styles.accountsChartBaseline}
          x1={PAD_LEFT}
          y1={baseline}
          x2={VIEW_WIDTH - PAD_RIGHT}
          y2={baseline}
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal breakdown — one row per bucket, bar length relative to the max
// ---------------------------------------------------------------------------
// Used for receivables aging, where the categories are ordered and named
// ("31–60 days") rather than continuous: a horizontal layout gives those
// names room to be read without rotating them.
export type BreakdownRow = {
  key: string;
  label: string;
  value: number;
  // Secondary figure shown after the amount, e.g. "3 invoices".
  caption?: string;
  tone: "revenue" | "cost" | "profit" | "overdue";
};

export function HorizontalBreakdown({
  rows,
  formatValue,
  emptyMessage = "Nothing outstanding in this range.",
}: {
  rows: BreakdownRow[];
  formatValue: (value: number) => string;
  emptyMessage?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) {
    return <p className={styles.accountsChartEmpty}>{emptyMessage}</p>;
  }

  // Scaled against the largest bucket rather than the total, so the shape of
  // the distribution stays visible even when one bucket dominates.
  const max = Math.max(...rows.map((row) => row.value));

  return (
    <ul className={styles.accountsBreakdown}>
      {rows.map((row) => (
        <li key={row.key} className={styles.accountsBreakdownRow}>
          <span className={styles.accountsBreakdownLabel}>{row.label}</span>
          <span className={styles.accountsBreakdownTrack}>
            <span
              className={`${styles.accountsBreakdownFill} ${styles[`accountsBar${capitalize(row.tone)}`]}`}
              style={{ width: max > 0 ? `${Math.max((row.value / max) * 100, row.value > 0 ? 1.5 : 0)}%` : "0%" }}
            />
          </span>
          <span className={styles.accountsBreakdownValue}>
            {formatValue(row.value)}
            {row.caption ? <span className={styles.accountsBreakdownCaption}>{row.caption}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Legend, shared by both charts
// ---------------------------------------------------------------------------
export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className={styles.accountsLegend}>
      {series.map((entry) => (
        <li key={entry.key} className={styles.accountsLegendItem}>
          <span
            className={`${styles.accountsLegendSwatch} ${styles[`accountsBar${capitalize(entry.tone)}`]}`}
            aria-hidden="true"
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
