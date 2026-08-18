"use client";

// ---------------------------------------------------------------------------
// <CartInquiryModal> — the /cart enquiry form, as a popup
// ---------------------------------------------------------------------------
// Opened by the floating "Proceed" button on <CartPageClient>
// (cart-page-client.tsx). The form used to sit permanently at the bottom of
// the cart page; it lives here instead so the page itself stays a clean list
// of what's in the cart, and the contact details are only asked for once the
// visitor has decided to send.
//
// Same shape as products/get-it-now-modal.tsx — portalled onto document.body,
// closes on Escape/backdrop click, locks page scroll while open — and it
// reuses home-page.module.css's `.form*` classes for the fields, so it looks
// identical to every other form on the site. The difference is what it sends:
// submitProductInquiry() with the whole cart attached (one inquiry for all
// items), not a single generic lead.
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import type { CartItem } from "@/lib/cart";
import { submitProductInquiry } from "@/lib/product-inquiries";
import homeStyles from "@/styles/home-page.module.css";
import styles from "@/styles/cart.module.css";

export function CartInquiryModal({
  items,
  totalItems,
  onClose,
  onSuccess,
}: {
  items: CartItem[];
  totalItems: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.checkValidity()) {
      form.reportValidity();
      setError("Please fill in the required fields before sending.");
      return;
    }

    setError(null);
    setSubmitting(true);

    const data = new FormData(form);
    try {
      await submitProductInquiry({
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        company: String(data.get("company") ?? ""),
        phone: String(data.get("phone") ?? ""),
        message: String(data.get("message") ?? ""),
        items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
      });
      // The parent owns the success screen (and empties the cart), since this
      // modal unmounts the moment it stops being rendered.
      onSuccess();
    } catch (submitError) {
      setSubmitting(false);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong sending your inquiry. Please try again.",
      );
    }
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      // Clicking the dark backdrop (but not the form itself) closes it.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Send your inquiry"
    >
      <div className={styles.modalScroll}>
        <form onSubmit={handleSubmit} className={homeStyles.form}>
          <div className={styles.modalHeader}>
            <div>
              <p className={styles.modalEyebrow}>
                {totalItems} {totalItems === 1 ? "item" : "items"}
              </p>
              <h2 className={styles.modalTitle}>Send your inquiry</h2>
              <p className={styles.formSubtext}>
                Tell us who you are and we&apos;ll come back with pricing, customisation options, and lead times for
                everything in your cart.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className={homeStyles.formGrid}>
            <div>
              <label htmlFor="cartName" className={homeStyles.formLabel}>
                Full name
              </label>
              <input
                id="cartName"
                name="name"
                type="text"
                autoComplete="name"
                required
                className={homeStyles.formInput}
              />
            </div>
            <div>
              <label htmlFor="cartEmail" className={homeStyles.formLabel}>
                Work email
              </label>
              <input
                id="cartEmail"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={homeStyles.formInput}
              />
            </div>
            <div>
              <label htmlFor="cartCompany" className={homeStyles.formLabel}>
                Company
              </label>
              <input
                id="cartCompany"
                name="company"
                type="text"
                autoComplete="organization"
                required
                className={homeStyles.formInput}
              />
            </div>
            <div>
              <label htmlFor="cartPhone" className={homeStyles.formLabel}>
                Phone <span className={homeStyles.formOptionalText}>(optional)</span>
              </label>
              <input id="cartPhone" name="phone" type="tel" autoComplete="tel" className={homeStyles.formInput} />
            </div>
            <div className={homeStyles.formFieldFull}>
              <label htmlFor="cartMessage" className={homeStyles.formLabel}>
                Anything else we should know? <span className={homeStyles.formOptionalText}>(optional)</span>
              </label>
              <textarea
                id="cartMessage"
                name="message"
                rows={4}
                placeholder="Branding requirements, delivery timeline, occasion…"
                className={`${homeStyles.formInput} ${homeStyles.formTextarea}`}
              />
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={homeStyles.formError}>
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" className={homeStyles.formSubmit} showArrow disabled={submitting}>
            {submitting ? "Sending…" : "Send Inquiry"}
          </Button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
