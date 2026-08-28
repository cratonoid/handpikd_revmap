"use client";

// ---------------------------------------------------------------------------
// <BrandCatalogueCard> — one catalogue tile in the /brand-catalogues grid
// ---------------------------------------------------------------------------
// Unlike catalogue-card.tsx (the static /catalogue page's icon tiles), these
// catalogues are real admin-uploaded PDFs, so the first converted page
// (imagePaths[0]) is shown as a real cover thumbnail rather than a themed
// icon. Clicking the card doesn't navigate — it tells the parent
// <BrandCataloguesPageClient> which catalogue's pages to open in the shared
// <GalleryLightbox>.
import { resolveMediaUrl } from "@/lib/api";
import { ArrowUpRightIcon } from "@/components/icons";
import styles from "@/styles/brand-catalogues.module.css";

export function BrandCatalogueCard({
  catalogueName,
  coverImagePath,
  onOpen,
}: {
  catalogueName: string;
  coverImagePath: string | undefined;
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className={styles.card}>
      <div className={styles.cardThumbWrap}>
        {coverImagePath ? (
          // eslint-disable-next-line @next/next/no-img-element -- cover comes from an admin-uploaded PDF page of unknown dimensions, same reasoning as gallery-lightbox.tsx
          <img
            src={resolveMediaUrl(coverImagePath)}
            alt={`${catalogueName} cover`}
            loading="lazy"
            className={styles.cardThumbImage}
          />
        ) : (
          <span className={styles.cardThumbPlaceholder}>No pages yet</span>
        )}
      </div>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{catalogueName}</h3>
        <span className={styles.cardViewGallery}>
          View Catalogue
          <ArrowUpRightIcon className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}
