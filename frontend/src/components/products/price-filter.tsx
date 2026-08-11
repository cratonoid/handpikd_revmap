"use client";

// ---------------------------------------------------------------------------
// <PriceFilter> — the dual-handle price range slider
// ---------------------------------------------------------------------------
// Dual-handle price range slider, mirrored by two plain-text (read-only)
// numbers showing the current low/high value.
//
// Like <CategoryFilter>, this component holds NO state of its own — `value`
// (the current [min, max] selection) is owned by the parent
// (products-page-client.tsx) and passed in; this component just displays it
// and calls `onChange` when the user drags a handle. See src/app/globals.css's
// big comment block on `.price-range-input` for how the
// two-overlapping-<input>s trick that fakes a dual-handle slider works at
// the CSS level (that part stays in globals.css since it targets the native
// <input type="range"> pseudo-elements, which CSS Modules handle the same
// way — the rest of this component's styling lives in
// src/styles/products.module.css).
import { formatInr } from "@/lib/public-products";
import styles from "@/styles/products.module.css";

export function PriceFilter({
  min,
  max,
  value, // the current [lowValue, highValue] pair being displayed
  onChange, // called with a new [lowValue, highValue] pair whenever the user changes something
  pending = false,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** True once the slider has moved away from the last applied range. */
  pending?: boolean;
}) {
  // Array destructuring: pulls the first and second items out of the
  // `value` tuple into two separately-named variables.
  const [lo, hi] = value;

  // Converts a raw price into a percentage position along the slider track
  // (0% = at `min`, 100% = at `max`) — used to position the colored "fill"
  // bar between the two handles. `|| 1` is a safety fallback that avoids
  // dividing by zero in the unlikely case `max` and `min` are equal.
  const pct = (n: number) => ((n - min) / (max - min || 1)) * 100;

  // Updates the LOW value, but "clamps" (constrains) it so it can never go
  // below the overall `min`, and never above the current `hi` value —
  // otherwise the two handles could cross over each other and produce a
  // confusing/invalid range like [800, 200].
  function setLo(n: number) {
    const clamped = Math.min(Math.max(min, n), hi);
    onChange([clamped, hi]);
  }

  // Same idea, mirrored, for the HIGH value.
  function setHi(n: number) {
    const clamped = Math.max(Math.min(max, n), lo);
    onChange([lo, clamped]);
  }

  return (
    <div>
      {/* The visual track. `position: relative` here is what lets the
          absolutely-positioned "fill" bar and the two range <input>s
          (which use `position: absolute; inset: 0` from globals.css) place
          themselves relative to THIS div instead of the whole page. */}
      <div className={styles.priceTrack}>
        {/* The colored bar BETWEEN the two handles. `left`/`right` are set
            as percentages (via the `pct` helper above) so it always spans
            exactly from the low handle's position to the high handle's
            position, no matter where they're dragged. Turns red instead of
            charcoal while a change is "pending" (not yet applied) — see
            the Apply Filters flow explained in products-page-client.tsx. */}
        <div
          className={`${styles.priceFill} ${pending ? styles.priceFillPending : ""}`}
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        {/* Two overlapping native range sliders — one for the low handle,
            one for the high handle. Both are visually mostly invisible
            (styled in globals.css) except for their draggable thumb
            circles. `aria-label` gives each one a distinct accessible name
            since neither has a visible <label> of its own. */}
        <input
          type="range"
          aria-label="Minimum price"
          min={min}
          max={max}
          step={1}
          value={lo}
          onChange={(e) => setLo(Number(e.target.value))} // range input values arrive as strings, so wrap in Number(...)
          className={`price-range-input ${pending ? "price-range-input--pending" : ""}`}
        />
        <input
          type="range"
          aria-label="Maximum price"
          min={min}
          max={max}
          step={1}
          value={hi}
          onChange={(e) => setHi(Number(e.target.value))}
          className={`price-range-input ${pending ? "price-range-input--pending" : ""}`}
        />
      </div>

      {/* The low/high values as plain read-only text below the slider —
          not editable boxes, just numbers that track the handles as they're
          dragged (see `setLo`/`setHi` above, called from the range
          <input>s' onChange). */}
      <div className={styles.priceInputRow}>
        <span className={`${styles.priceValue} ${pending ? styles.priceValuePending : ""}`}>
          {formatInr(lo)}
        </span>
        <span className={styles.priceInputSeparator} aria-hidden="true">
          &ndash; {/* an en-dash ("–") between the two numbers, written as an HTML entity */}
        </span>
        <span className={`${styles.priceValue} ${pending ? styles.priceValuePending : ""}`}>
          {formatInr(hi)}
        </span>
      </div>
    </div>
  );
}
