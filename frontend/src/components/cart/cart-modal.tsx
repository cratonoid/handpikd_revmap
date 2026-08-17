"use client";

// ---------------------------------------------------------------------------
// <CartModal> — view/edit the cart, then send it as one multi-item enquiry
// ---------------------------------------------------------------------------
// Opened from the header's cart icon (header.tsx). Three internal steps,
// tracked by local `step` state rather than separate route/components:
//   "cart"    — the cart's contents: quantity steppers, remove, subtotal.
//   "form"    — contact details, prefilled with an itemized message. Only
//               reachable once the cart has at least one item.
//   "success" — confirmation; clears the cart once shown.
//
// Reuses <GetItNowModal>'s overlay/portal/scroll-lock approach (see that
// file's module comment for why the portal specifically is needed — same
// hover-transform containing-block issue applies to the header's cart
// button) and its home-page.module.css form fields, but keeps its own
// step state rather than being a variant of that component, since the
// "review cart" step has no equivalent there.
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/button";
import { CheckIcon, MinusIcon, PlusIcon, TrashIcon, XMarkIcon } from "@/components/icons";
import { useCart, type CartItem } from "@/lib/cart";
import { submitLead } from "@/lib/lead-form";
import { formatInr } from "@/lib/public-products";
import homeStyles from "@/styles/home-page.module.css";
import productStyles from "@/styles/products.module.css";
import styles from "@/styles/cart.module.css";

type Step = "cart" | "form" | "success";

function buildCartMessage(items: CartItem[]): string {
  const lines = items.map((i) => `- ${i.name} x${i.quantity} (${formatInr(i.price)} each)`);
  return `I'm interested in the following items:\n${lines.join("\n")}`;
}

export function CartModal({ onClose }: { onClose: () => void }) {
  const { items, subtotal, removeFromCart, setCartQuantity, clearCart } = useCart();
  const [step, setStep] = useState<Step>("cart");
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
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
      clearCart();
      setStatus("idle");
      setStep("success");
    } catch {
      setStatus("idle");
      setError("Something went wrong sending your enquiry. Please try again or reach us on WhatsApp.");
    }
  }

  return createPortal(
    <div
      className={productStyles.getItNowOverlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Your cart"
    >
      <div className={productStyles.getItNowScroll}>
        {step === "success" ? (
          <div className={homeStyles.formSuccessWrap}>
            <span className={homeStyles.formSuccessIcon}>
              <CheckIcon className="h-6 w-6" />
            </span>
            <h3 className={homeStyles.formSuccessHeading}>Thanks — we&apos;ll be in touch.</h3>
            <p className={homeStyles.formSuccessText}>
              A member of the Handpikd team will reach out within one business day about your cart.
            </p>
            <button type="button" onClick={onClose} className={homeStyles.formSuccessLink}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className={productStyles.getItNowHeader}>
              <div>
                <p className={productStyles.getItNowEyebrow}>{step === "cart" ? "Your Cart" : "Send Enquiry"}</p>
                <h3 className={productStyles.getItNowTitle}>
                  {step === "cart" ? `${items.length} item${items.length === 1 ? "" : "s"}` : "Your details"}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={productStyles.getItNowCloseButton}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {step === "cart" ? (
              items.length === 0 ? (
                <p className={styles.emptyCart}>Your cart is empty. Add a product to get started.</p>
              ) : (
                <>
                  <ul className={styles.cartList}>
                    {items.map((item) => (
                      <li key={item.productId} className={styles.cartRow}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic product image URL */}
                        <img src={item.image} alt="" className={styles.cartThumb} />
                        <div className={styles.cartRowBody}>
                          <p className={styles.cartRowName}>{item.name}</p>
                          <p className={styles.cartRowPrice}>{formatInr(item.price)} each</p>
                        </div>
                        <div className={styles.qtyStepper}>
                          <button
                            type="button"
                            aria-label={`Decrease quantity of ${item.name}`}
                            onClick={() => setCartQuantity(item.productId, item.quantity - 1)}
                            className={styles.qtyButton}
                          >
                            <MinusIcon className="h-3.5 w-3.5" />
                          </button>
                          <span className={styles.qtyValue}>{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={`Increase quantity of ${item.name}`}
                            onClick={() => setCartQuantity(item.productId, item.quantity + 1)}
                            className={styles.qtyButton}
                          >
                            <PlusIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${item.name} from cart`}
                          onClick={() => removeFromCart(item.productId)}
                          className={styles.removeButton}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <div className={styles.subtotalRow}>
                    <span>Subtotal</span>
                    <span>{formatInr(subtotal)}</span>
                  </div>

                  <Button type="button" variant="primary" className={styles.cartCta} showArrow onClick={() => setStep("form")}>
                    Send Enquiry
                  </Button>
                </>
              )
            ) : (
              <form onSubmit={handleSubmit} className={homeStyles.form}>
                <div className={homeStyles.formGrid}>
                  <div>
                    <label htmlFor="cartName" className={homeStyles.formLabel}>
                      Full name
                    </label>
                    <input id="cartName" name="name" type="text" autoComplete="name" required className={homeStyles.formInput} />
                  </div>
                  <div>
                    <label htmlFor="cartEmail" className={homeStyles.formLabel}>
                      Work email
                    </label>
                    <input id="cartEmail" name="email" type="email" autoComplete="email" required className={homeStyles.formInput} />
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
                      Message
                    </label>
                    <textarea
                      id="cartMessage"
                      name="message"
                      rows={5}
                      required
                      defaultValue={buildCartMessage(items)}
                      className={`${homeStyles.formInput} ${homeStyles.formTextarea}`}
                    />
                  </div>
                </div>

                {error && (
                  <p role="alert" aria-live="polite" className={homeStyles.formError}>
                    {error}
                  </p>
                )}

                <div className={styles.formActionsRow}>
                  <button type="button" onClick={() => setStep("cart")} className={styles.backButton}>
                    &larr; Back to cart
                  </button>
                  <Button type="submit" variant="primary" showArrow disabled={status === "submitting"}>
                    {status === "submitting" ? "Sending…" : "Send enquiry"}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}