"use client";

// ---------------------------------------------------------------------------
// <AddToGiftListButton> — the small CTA on every product card
// ---------------------------------------------------------------------------
// Static placeholder CTA — no cart/route wired up yet. Clicking just flashes
// a brief "Added" confirmation for feedback, then resets. There's no real
// "gift list" feature built yet — this exists purely to show what the
// interaction WOULD feel like, with all the visual feedback already in
// place for whenever real add-to-list logic gets wired up.
//
// Styling lives in src/styles/products.module.css.
import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/icons";
import styles from "@/styles/products.module.css";

export function AddToGiftListButton({ productName }: { productName: string }) {
  // Whether this specific button is currently showing its "Added ✓" state.
  const [added, setAdded] = useState(false);

  // Whenever `added` becomes `true`, start a 1.8-second timer that flips it
  // back to `false` automatically — this is what makes the "Added"
  // confirmation temporary instead of permanent.
  useEffect(() => {
    if (!added) return; // do nothing when `added` becomes false — only start a timer when it becomes true
    const timer = window.setTimeout(() => setAdded(false), 1800);
    // Cleanup: if `added` changes again before the 1.8s is up (e.g. the
    // user clicks the button again quickly), cancel the old timer so two
    // timers don't end up racing each other.
    return () => window.clearTimeout(timer);
  }, [added]); // re-run this effect every time `added` changes

  return (
    <button
      type="button"
      onClick={() => setAdded(true)}
      aria-pressed={added} // marks this as a toggle-style button for assistive tech
      // The accessible name changes along with the visual state, so a
      // screen reader user hears "Add [product] to gift list" normally,
      // and "[product] added to gift list" right after clicking.
      aria-label={added ? `${productName} added to gift list` : `Add ${productName} to gift list`}
      className={`${styles.giftButton} ${added ? styles.giftButtonAdded : ""}`}
    >
      {/* Ternary picks which content to render based on `added` — the
          checkmark icon + "Added" text, or just the plain call-to-action
          text. */}
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
