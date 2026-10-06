// ---------------------------------------------------------------------------
// Homepage hero sale touches — <HeroSaleBadge> and <HeroSaleStamp>
// ---------------------------------------------------------------------------
// <HeroSaleBadge> stands in for the hero's usual eyebrow pill during the
// sale; <HeroSaleStamp> is a round gold "sticker" sitting on the hero photo.
import { DiyaIcon } from "@/components/sale/diya-icon";
import { SALE_NAME, SALE_OFFER } from "@/components/sale/sale-config";
import styles from "@/styles/sale.module.css";

export function HeroSaleBadge() {
  return (
    <span className={styles.heroBadge}>
      <DiyaIcon className={styles.heroBadgeDiya} />
      {SALE_NAME} · {SALE_OFFER}
    </span>
  );
}

export function HeroSaleStamp() {
  return (
    <div className={styles.heroStamp} aria-hidden="true">
      <span className={styles.heroStampSmall}>Diwali</span>
      <span className={styles.heroStampBig}>Sale</span>
      <span className={styles.heroStampSmall}>Up to 20% off</span>
    </div>
  );
}
