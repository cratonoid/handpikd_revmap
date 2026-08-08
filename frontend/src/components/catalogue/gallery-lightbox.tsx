"use client";

// ---------------------------------------------------------------------------
// <GalleryLightbox> — full-screen modal showing every photo in one folder
// ---------------------------------------------------------------------------
// Rendered by <CataloguePageClient> whenever a category card is clicked.
// Plain <img> tags (not next/image) are used deliberately here: some of
// these folders hold 100+ photos of varying, unknown dimensions, and this
// modal just needs them to stack in a scrollable column at whatever height
// they naturally render at — there's no fixed grid slot to optimize for.
import { useEffect } from "react";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/catalogue.module.css";

export function GalleryLightbox({
  title,
  images,
  onClose,
}: {
  title: string;
  images: string[];
  onClose: () => void;
}) {
  // Close on Escape, and lock the page's own scroll while the modal is open
  // (so scrolling inside the lightbox doesn't also scroll the page behind
  // it). Both are undone in the cleanup function when the modal unmounts.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={styles.lightboxOverlay}
      // Clicking the dark backdrop (but not the modal itself) closes it —
      // `e.target === e.currentTarget` is true only when the click landed
      // directly on this outer div, not on anything nested inside it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={styles.lightboxContainer}>
        <div className={styles.lightboxHeader}>
          <h2 className={styles.lightboxTitle}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close gallery"
            className={styles.lightboxCloseButton}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className={styles.lightboxScroll}>
          {images.map((src, index) => (
            <div key={src} className={styles.lightboxImageItem}>
              {/* eslint-disable-next-line @next/next/no-img-element -- see file-level comment: sizes are unknown ahead of time, plain <img> fits better than next/image here */}
              <img
                src={src}
                alt={`${title} — photo ${index + 1} of ${images.length}`}
                loading="lazy"
                className={styles.lightboxImage}
              />
              <p className={styles.lightboxImageNumber}>
                {index + 1} / {images.length}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
