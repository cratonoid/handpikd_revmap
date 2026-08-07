"use client";

// ---------------------------------------------------------------------------
// <CatalogueCard> — one category tile in the /catalogue grid
// ---------------------------------------------------------------------------
// A plain button (not a link) — clicking it doesn't navigate anywhere, it
// tells the parent <CataloguePageClient> which folder's gallery to open in
// the lightbox (see catalogue-page-client.tsx for the state that lives
// above this component).
//
// Shows a themed icon rather than a cover photo — the real photos in
// public/catalogs are scanned catalogue PAGES (either a generic branded
// cover slide or a dense multi-item grid), not individual product shots,
// so none of them crop into a clean square thumbnail. The actual photos
// still show up once a card is clicked, inside the lightbox gallery.
import {
  ArrowUpRightIcon,
  BottleIcon,
  DiaryIcon,
  GiftBoxIcon,
  IdCardIcon,
  KeychainIcon,
  MugIcon,
  NotebookIcon,
  PenIcon,
  TrophyIcon,
} from "@/components/icons";
import type { CatalogueIconName } from "@/lib/catalogue-data";
import styles from "@/styles/catalogue.module.css";

// Exported so <CataloguePageClient> can reuse the exact same mapping for
// each category section's heading icon.
export const catalogueIconComponents: Record<CatalogueIconName, typeof GiftBoxIcon> = {
  "gift-box": GiftBoxIcon,
  bottle: BottleIcon,
  diary: DiaryIcon,
  notebook: NotebookIcon,
  "id-card": IdCardIcon,
  keychain: KeychainIcon,
  mug: MugIcon,
  pen: PenIcon,
  trophy: TrophyIcon,
};

export function CatalogueCard({
  title,
  icon,
  onOpen,
}: {
  title: string;
  icon: CatalogueIconName;
  onOpen: () => void;
}) {
  const Icon = catalogueIconComponents[icon];

  return (
    <button type="button" onClick={onOpen} className={styles.card}>
      <div className={styles.cardIconWrap}>
        <Icon className={styles.cardIcon} />
      </div>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <span className={styles.cardViewGallery}>
          View Gallery
          <ArrowUpRightIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
