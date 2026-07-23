"use client";

// Static placeholder CTA — no cart/route wired up yet. Clicking just flashes
// a brief "Added" confirmation for feedback, then resets.
import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/icons";

export function AddToGiftListButton({ productName }: { productName: string }) {
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), 1800);
    return () => window.clearTimeout(timer);
  }, [added]);

  return (
    <button
      type="button"
      onClick={() => setAdded(true)}
      aria-pressed={added}
      aria-label={added ? `${productName} added to gift list` : `Add ${productName} to gift list`}
      className={`mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full border text-xs font-semibold tracking-wide transition-colors duration-200 active:scale-[0.98] ${
        added
          ? "border-charcoal bg-charcoal text-cream"
          : "border-charcoal/70 text-charcoal hover:bg-charcoal hover:text-cream"
      }`}
    >
      {added ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
          Added
        </>
      ) : (
        "Add to Gift List"
      )}
    </button>
  );
}
