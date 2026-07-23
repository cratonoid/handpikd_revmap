"use client";

// Dual-handle price range slider, mirrored by two editable numeric inputs.
export function PriceFilter({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}) {
  const [lo, hi] = value;
  const pct = (n: number) => ((n - min) / (max - min || 1)) * 100;

  function setLo(n: number) {
    const clamped = Math.min(Math.max(min, n), hi);
    onChange([clamped, hi]);
  }

  function setHi(n: number) {
    const clamped = Math.max(Math.min(max, n), lo);
    onChange([lo, clamped]);
  }

  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-border">
        <div
          className="absolute h-1.5 rounded-full bg-charcoal"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        <input
          type="range"
          aria-label="Minimum price"
          min={min}
          max={max}
          step={1}
          value={lo}
          onChange={(e) => setLo(Number(e.target.value))}
          className="price-range-input"
        />
        <input
          type="range"
          aria-label="Maximum price"
          min={min}
          max={max}
          step={1}
          value={hi}
          onChange={(e) => setHi(Number(e.target.value))}
          className="price-range-input"
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <label className="flex-1">
          <span className="sr-only">Minimum price</span>
          <span className="flex items-center rounded-lg border border-border bg-white px-3 py-2 text-sm text-charcoal">
            $
            <input
              type="number"
              min={min}
              max={hi}
              value={lo}
              onChange={(e) => setLo(Number(e.target.value))}
              className="ml-1 w-full bg-transparent outline-none"
            />
          </span>
        </label>
        <span className="text-ink/50" aria-hidden="true">
          &ndash;
        </span>
        <label className="flex-1">
          <span className="sr-only">Maximum price</span>
          <span className="flex items-center rounded-lg border border-border bg-white px-3 py-2 text-sm text-charcoal">
            $
            <input
              type="number"
              min={lo}
              max={max}
              value={hi}
              onChange={(e) => setHi(Number(e.target.value))}
              className="ml-1 w-full bg-transparent outline-none"
            />
          </span>
        </label>
      </div>
    </div>
  );
}
