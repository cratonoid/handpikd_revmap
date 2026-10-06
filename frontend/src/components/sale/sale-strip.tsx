// ---------------------------------------------------------------------------
// <SaleStrip> — running announcement bar shown above the header on every page
// ---------------------------------------------------------------------------
// Rendered by <Header> itself, so every page that has the site header gets
// it. It sits OUTSIDE the sticky <header>, so it scrolls away normally and
// the header keeps its usual sticky/hide-on-scroll behavior.
//
// Same seamless-loop trick as <ClientMarquee>: the message row is rendered
// twice back to back and the track slides left by exactly 50%, so the second
// copy lands where the first began right as the animation repeats.
//
// Wording lives in sale-config.ts.
import Link from "next/link";
import { DiyaIcon } from "@/components/sale/diya-icon";
import { SALE_NAME, SALE_OFFER, SALE_STRIP_MESSAGES } from "@/components/sale/sale-config";
import styles from "@/styles/sale.module.css";

// One half of the loop. Messages repeat a few times so each half is wider
// than even a very wide screen, otherwise a gap would show before it loops.
function StripRow() {
  const repeated = [...SALE_STRIP_MESSAGES, ...SALE_STRIP_MESSAGES, ...SALE_STRIP_MESSAGES];
  return (
    <ul className={styles.stripRow} aria-hidden="true">
      {repeated.map((text, i) => (
        <li key={i} className={styles.stripItem}>
          <DiyaIcon className={styles.stripDiya} />
          {text}
        </li>
      ))}
    </ul>
  );
}

export function SaleStrip() {
  return (
    <div className={styles.stripWrap}>
      <Link
        href="/products"
        className={styles.strip}
        aria-label={`${SALE_NAME} is live: ${SALE_OFFER}. Shop now.`}
      >
        <div className={styles.stripTrack}>
          <StripRow />
          <StripRow />
        </div>
      </Link>
      {/* Thin marigold-and-maroon "toran" edge under the strip. */}
      <div className={styles.toran} aria-hidden="true" />
    </div>
  );
}
