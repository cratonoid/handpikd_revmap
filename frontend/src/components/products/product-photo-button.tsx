"use client";

// ---------------------------------------------------------------------------
// <ProductPhotoButton> — the product card's image, clickable to see it whole
// ---------------------------------------------------------------------------
// The card crops its image to a square (`object-fit: cover`), so a tall or
// wide photo loses its edges. Clicking the image opens it uncropped in a
// full-screen popup; Escape, the close button or a click on the dark
// backdrop closes it.
//
// Broken out of product-card.tsx for the same reason add-to-cart-button.tsx
// is: the card stays a Server Component and only this piece needs state.
//
// The popup is portalled onto `document.body` for the reason spelled out in
// get-it-now-modal.tsx: the card's hover `transform` would otherwise become
// the containing block for the `position: fixed` overlay and shrink it to
// the size of the card.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/products.module.css";

export function ProductPhotoButton({ src, alt, name }: { src: string; alt: string; name: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    // Back to the image that opened it, so keyboard users keep their place.
    buttonRef.current?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View full photo of ${name}`}
        className={styles.cardImageButton}
      >
        {/* Plain <img>, not next/image — see product-card.tsx. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset */}
        <img src={src} alt={alt} loading="lazy" className={styles.cardImage} />
      </button>
      {open && createPortal(<PhotoPopup src={src} alt={alt} name={name} onClose={close} />, document.body)}
    </>
  );
}

function PhotoPopup({ src, alt, name, onClose }: { src: string; alt: string; name: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close on Escape and lock the page's scroll while open — same as
  // get-it-now-modal.tsx.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={styles.photoPopupOverlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className={styles.photoPopupCloseButton}
      >
        <XMarkIcon className="h-5 w-5" />
      </button>
      <figure className={styles.photoPopupFigure}>
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset */}
        <img src={src} alt={alt} className={styles.photoPopupImage} />
        <figcaption className={styles.photoPopupCaption}>{name}</figcaption>
      </figure>
    </div>
  );
}
