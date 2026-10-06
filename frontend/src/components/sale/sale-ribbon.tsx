// ---------------------------------------------------------------------------
// <SaleRibbon> — small festive tag on product and catalogue card images
// ---------------------------------------------------------------------------
// Positioned absolutely, so the parent must be `position: relative` (both
// card image wrappers already are). `corner` picks the side so it never
// collides with a card's existing badge.
import { SALE_RIBBON } from "@/components/sale/sale-config";
import styles from "@/styles/sale.module.css";

export function SaleRibbon({ corner = "right" }: { corner?: "left" | "right" }) {
  return (
    <span
      className={`${styles.ribbon} ${corner === "left" ? styles.ribbonLeft : styles.ribbonRight}`}
    >
      {SALE_RIBBON}
    </span>
  );
}
