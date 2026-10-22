"use client";

// ---------------------------------------------------------------------------
// <CatalogueCard> — one catalogue tile in the /catalogue grid
// ---------------------------------------------------------------------------
// Catalogues are real admin-uploaded PDFs, so the first converted page
// (imagePaths[0]) is shown as a real cover thumbnail. Clicking the card
// doesn't navigate — it tells the parent <CataloguePageClient> which
// catalogue's pages to open in the shared <GalleryLightbox>.
//
// The cover is a full-resolution PDF page (often 0.5–1MB+), so it goes
// through next/image to be served at thumbnail size. The optimizer is given
// the backend-relative "/media/..." path, which it fetches through the
// /media rewrite in next.config.ts; anything else is shown as-is.
import Image from "next/image";
import { resolveMediaUrl } from "@/lib/api";
import { ArrowUpRightIcon } from "@/components/icons";
import { SaleRibbon } from "@/components/sale/sale-ribbon"; // SALE:
import styles from "@/styles/catalogue.module.css";

export function CatalogueCard({
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
          <Image
            src={coverImagePath.startsWith("/media/") ? coverImagePath : resolveMediaUrl(coverImagePath)}
            unoptimized={!coverImagePath.startsWith("/media/")}
            alt={`${catalogueName} cover`}
            fill
            // Matches .categoryGrid: 2 columns, 4 from 640px, 5 from 1024px
            // inside the 72rem page.
            sizes="(min-width: 1024px) 230px, (min-width: 640px) 25vw, 50vw"
            className={styles.cardThumbImage}
          />
        ) : (
          <span className={styles.cardThumbPlaceholder}>No pages yet</span>
        )}
        {/* SALE: festive ribbon */}
        <SaleRibbon corner="left" />
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
