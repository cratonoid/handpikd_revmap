// ---------------------------------------------------------------------------
// <SaleBand> — slim festive band at the top of /products and /catalogue
// ---------------------------------------------------------------------------
// Both pages normally go straight from the header into their content, so
// this is a short band (not a tall banner) that doesn't push the grid far
// down the screen.
import { DiyaIcon } from "@/components/sale/diya-icon";
import { SALE_NAME, SALE_OFFER } from "@/components/sale/sale-config";
import styles from "@/styles/sale.module.css";

export function SaleBand({ tagline }: { tagline: string }) {
  return (
    <section className={styles.band} aria-label={SALE_NAME}>
      <div className={styles.bandInner}>
        <DiyaIcon className={styles.bandDiya} />
        <div className={styles.bandText}>
          <p className={styles.bandTitle}>
            {SALE_NAME} <span className={styles.bandOffer}>· {SALE_OFFER}</span>
          </p>
          <p className={styles.bandTagline}>{tagline}</p>
        </div>
        <DiyaIcon className={`${styles.bandDiya} ${styles.bandDiyaEnd}`} />
      </div>
    </section>
  );
}
