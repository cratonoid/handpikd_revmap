"use client";

// ---------------------------------------------------------------------------
// <GetItNowModal> — the "Get It Now" popup enquiry form
// ---------------------------------------------------------------------------
// Opened by <GetItNowButton> (get-it-now-button.tsx) from a product card.
// There's no existing popup/dialog version of the site's contact form
// anywhere — the homepage's "Connect With Us" section (home_page/connect.tsx
// + home_page/contact-form.tsx) is a plain always-rendered section that CTAs
// elsewhere just anchor-scroll to ("/#connect"). This reuses that same form's
// fields and submitLead() call, just wrapped in an overlay instead, since the
// /products page has no Connect section of its own to scroll to. The
// message field is pre-filled with the product name so the lead is tied to
// what was actually clicked, rather than being a generic enquiry.
//
// Rendered via a portal straight onto `document.body`, NOT inline where
// <GetItNowButton> sits in the tree. Reason: product-card.tsx's
// `.cardArticle:hover { transform: translateY(-4px) }` makes the card a CSS
// "containing block" for any `position: fixed` descendant while hovered —
// exactly the state the card is in right after being clicked. Without the
// portal, this modal's `.getItNowOverlay` (position: fixed; inset: 0) was
// being sized/positioned relative to that small, transformed card instead of
// the viewport, so it rendered as a clipped sliver in the middle of the grid
// instead of a full-screen popup. A portal sidesteps the issue entirely,
// regardless of whatever transforms/filters cards pick up in the future.
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/button";
import { CheckIcon, XMarkIcon } from "@/components/icons";
import { submitLead } from "@/lib/lead-form";
import homeStyles from "@/styles/home-page.module.css";
import styles from "@/styles/products.module.css";

type Status = "idle" | "submitting" | "success";

export function GetItNowModal({ productName, onClose }: { productName: string; onClose: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Close on Escape, and lock the page's own scroll while the modal is open
  // — same behavior as gallery-lightbox.tsx's overlay.
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
    setStatus("submitting");

    const data = new FormData(form);
    try {
      await submitLead({
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        company: String(data.get("company") ?? ""),
        phone: String(data.get("phone") ?? ""),
        message: String(data.get("message") ?? ""),
      });
      setStatus("success");
    } catch {
      setStatus("idle");
      setError("Something went wrong sending your enquiry. Please try again or reach us on WhatsApp.");
    }
  }

  return createPortal(
    <div
      className={styles.getItNowOverlay}
      // Clicking the dark backdrop (but not the form itself) closes it —
      // same `target === currentTarget` trick as gallery-lightbox.tsx.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Enquire about ${productName}`}
    >
      <div className={styles.getItNowScroll}>
        {status === "success" ? (
          <div className={homeStyles.formSuccessWrap}>
            <span className={homeStyles.formSuccessIcon}>
              <CheckIcon className="h-6 w-6" />
            </span>
            <h3 className={homeStyles.formSuccessHeading}>Thanks — we&apos;ll be in touch.</h3>
            <p className={homeStyles.formSuccessText}>
              A member of the Handpikd team will reach out within one business day about {productName}.
            </p>
            <button type="button" onClick={onClose} className={homeStyles.formSuccessLink}>
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={homeStyles.form}>
            <div className={styles.getItNowHeader}>
              <div>
                <p className={styles.getItNowEyebrow}>Get It Now</p>
                <h3 className={styles.getItNowTitle}>{productName}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={styles.getItNowCloseButton}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className={homeStyles.formGrid}>
              <div>
                <label htmlFor="getItNowName" className={homeStyles.formLabel}>
                  Full name
                </label>
                <input
                  id="getItNowName"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  className={homeStyles.formInput}
                />
              </div>
              <div>
                <label htmlFor="getItNowEmail" className={homeStyles.formLabel}>
                  Work email
                </label>
                <input
                  id="getItNowEmail"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={homeStyles.formInput}
                />
              </div>
              <div>
                <label htmlFor="getItNowCompany" className={homeStyles.formLabel}>
                  Company
                </label>
                <input
                  id="getItNowCompany"
                  name="company"
                  type="text"
                  autoComplete="organization"
                  required
                  className={homeStyles.formInput}
                />
              </div>
              <div>
                <label htmlFor="getItNowPhone" className={homeStyles.formLabel}>
                  Phone <span className={homeStyles.formOptionalText}>(optional)</span>
                </label>
                <input id="getItNowPhone" name="phone" type="tel" autoComplete="tel" className={homeStyles.formInput} />
              </div>
              <div className={homeStyles.formFieldFull}>
                <label htmlFor="getItNowMessage" className={homeStyles.formLabel}>
                  What are you looking for?
                </label>
                <textarea
                  id="getItNowMessage"
                  name="message"
                  rows={4}
                  required
                  defaultValue={`I'm interested in ${productName}.`}
                  className={`${homeStyles.formInput} ${homeStyles.formTextarea}`}
                />
              </div>
            </div>

            {error && (
              <p role="alert" aria-live="polite" className={homeStyles.formError}>
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              className={homeStyles.formSubmit}
              showArrow
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Sending…" : "Send enquiry"}
            </Button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
