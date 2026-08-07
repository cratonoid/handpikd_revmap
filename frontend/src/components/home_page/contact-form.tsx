"use client";

// ---------------------------------------------------------------------------
// <ContactForm> — the "Connect With Us" form
// ---------------------------------------------------------------------------
// FRONTEND-ONLY for now: submitting this form validates the fields and shows
// a success message, but does NOT actually send an email anywhere yet (see
// the TODO comment inside handleSubmit below). Needs "use client" because it
// uses React state (useState) and a submit event handler — both require
// running in the browser.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { CheckIcon } from "@/components/icons";
import styles from "@/styles/home-page.module.css";

// A small custom type restricting `status` to exactly these two string
// values, instead of allowing any arbitrary string — TypeScript will flag
// an error if the code ever tries to set it to something else by mistake.
type Status = "idle" | "success";

export function ContactForm() {
  // `status` tracks whether we're still showing the form ("idle") or the
  // "thanks, we'll be in touch" confirmation ("success").
  const [status, setStatus] = useState<Status>("idle");
  // `error` holds a validation error message to display, or `null` when
  // there isn't one.
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Stops the browser's default behavior of reloading the page on form
    // submit — necessary any time you want to handle a submit with
    // JavaScript instead.
    event.preventDefault();
    const form = event.currentTarget;

    // `form.checkValidity()` is a built-in browser method that checks every
    // field's HTML validation rules (the `required` and `type="email"`
    // attributes set on the inputs further down) and returns true/false.
    // `form.reportValidity()` additionally makes the browser show its own
    // native validation tooltips (e.g. "Please fill out this field")
    // pointing at whichever field is invalid.
    if (!form.checkValidity()) {
      form.reportValidity();
      setError("Please fill in the required fields before sending.");
      return;
    }

    // Frontend-only for now — no request is sent yet.
    // TODO: POST to a backend endpoint (e.g. /api/v1/contact) that sends this
    // through SMTP once that service exists.
    setError(null);
    setStatus("success");
    form.reset(); // clears every field back to empty, so if the user clicks "Send another message" they get a blank form
  }

  // Early return: if the form has already been successfully "submitted",
  // render the confirmation message INSTEAD OF the form entirely, rather
  // than showing both at once.
  if (status === "success") {
    return (
      <div className={styles.formSuccessWrap}>
        <span className={styles.formSuccessIcon}>
          <CheckIcon className="h-6 w-6" />
        </span>
        <h3 className={styles.formSuccessHeading}>Thanks — we&apos;ll be in touch.</h3>
        <p className={styles.formSuccessText}>
          A member of the Handpikd team will reach out within one business
          day to talk through your gifting program.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")} // lets the user go back and submit again
          className={styles.formSuccessLink}
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate={false} // explicit (this is the browser's default anyway) — keeps the browser's built-in field validation active, which checkValidity()/reportValidity() above rely on
      onSubmit={handleSubmit}
      className={styles.form}
    >
      {/* 1 column on mobile, 2 columns from `sm:` up (see `.formGrid`).
          Each field wrapper below is 1 column except the message textarea,
          which spans both (`.formFieldFull`). */}
      <div className={styles.formGrid}>
        <div>
          {/* `htmlFor="name"` on the <label> paired with `id="name"` on the
              <input> is what makes clicking the label focus the input —
              important both for usability and accessibility (screen
              readers announce the label when the input receives focus). */}
          <label htmlFor="name" className={styles.formLabel}>
            Full name
          </label>
          <input id="name" name="name" type="text" autoComplete="name" required className={styles.formInput} />
        </div>
        <div>
          <label htmlFor="email" className={styles.formLabel}>
            Work email
          </label>
          {/* `type="email"` gives the browser built-in "is this a validly
              formatted email address?" validation for free, and switches
              mobile keyboards to show an "@" key. */}
          <input id="email" name="email" type="email" autoComplete="email" required className={styles.formInput} />
        </div>
        <div>
          <label htmlFor="company" className={styles.formLabel}>
            Company
          </label>
          <input
            id="company"
            name="company"
            type="text"
            autoComplete="organization"
            required
            className={styles.formInput}
          />
        </div>
        <div>
          <label htmlFor="phone" className={styles.formLabel}>
            Phone <span className={styles.formOptionalText}>(optional)</span>
          </label>
          {/* No `required` here — phone is the one optional field. */}
          <input id="phone" name="phone" type="tel" autoComplete="tel" className={styles.formInput} />
        </div>
        <div className={styles.formFieldFull}>
          <label htmlFor="message" className={styles.formLabel}>
            What are you looking for?
          </label>
          <textarea
            id="message"
            name="message"
            rows={4}
            required
            placeholder="Tell us about the program you have in mind — recipients, timing, budget…"
            className={`${styles.formInput} ${styles.formTextarea}`} // formTextarea just disables manual resize-dragging
          />
        </div>
      </div>

      {/* `error && (...)` only renders the paragraph when `error` is
          truthy (not null/empty) — React skips rendering anything for a
          falsy value here. `role="alert"` + `aria-live="polite"` together
          tell screen readers to automatically announce this text the
          moment it appears, without the user needing to manually navigate
          to it. */}
      {error && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className={styles.formSubmit} showArrow>
        Send message
      </Button>
    </form>
  );
}
