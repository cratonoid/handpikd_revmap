"use client";

// ---------------------------------------------------------------------------
// <GetItNowButton> — the CTA on every product card
// ---------------------------------------------------------------------------
// Replaces the old static "Add to Gift List" placeholder button (which had
// no real feature behind it) with a real action: opens <GetItNowModal>, a
// popup version of the site's "Connect With Us" enquiry form, pre-filled
// with this product's name.
import { useState } from "react";
import { GetItNowModal } from "@/components/products/get-it-now-modal";
import styles from "@/styles/products.module.css";

export function GetItNowButton({ productName }: { productName: string }) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setModalOpen(true)} className={styles.getItNowButton}>
        Get It Now
      </button>
      {modalOpen && <GetItNowModal productName={productName} onClose={() => setModalOpen(false)} />}
    </>
  );
}
