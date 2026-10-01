// ---------------------------------------------------------------------------
// <SaleStrip> — TEMPORARY running announcement bar for the 1–5 October sale
// ---------------------------------------------------------------------------
// Everything sale-related lives in src/components/sale/, src/styles/
// sale.module.css and public/sale/. To end the sale, delete those three and
// the lines marked `SALE:` in src/app/page.tsx.
//
// Same seamless-loop trick as <ClientMarquee>: the message row is rendered
// twice back to back and the track slides left by exactly 50%, so the second
// copy lands where the first began right as the animation repeats.
import Link from "next/link";
import styles from "@/styles/sale.module.css";

const messages = [
  "Sale is live",
  "Up to 20% off on all products",
  "1 – 5 October only",
  "Shop the catalogue",
];

// One half of the loop. Messages repeat a few times so each half is wider
// than even a very wide screen, otherwise a gap would show before it loops.
function StripRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  const repeated = [...messages, ...messages, ...messages];
  return (
    <ul className={styles.stripRow} aria-hidden={ariaHidden || undefined}>
      {repeated.map((text, i) => (
        <li key={i} className={styles.stripItem}>
          <span className={styles.stripStar} aria-hidden="true">
            ✦
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

export function SaleStrip() {
  return (
    <Link
      href="/catalogue"
      className={styles.strip}
      aria-label="Sale is live: up to 20% off on all products, 1 to 5 October. Shop the catalogue."
    >
      <div className={styles.stripTrack}>
        <StripRow ariaHidden />
        <StripRow ariaHidden />
      </div>
    </Link>
  );
}
