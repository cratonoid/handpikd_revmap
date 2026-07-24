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

// A small custom type restricting `status` to exactly these two string
// values, instead of allowing any arbitrary string — TypeScript will flag
// an error if the code ever tries to set it to something else by mistake.
type Status = "idle" | "success";

// Shared Tailwind classes for every text input/textarea in this form,
// defined once so all the fields look identical and this is the one place
// to change if the field styling needs to be updated.
const fieldClasses =
  "w-full rounded-xl border border-border bg-cream px-4 py-3 text-sm text-charcoal placeholder:text-ink/40 outline-none transition-colors focus:border-charcoal";

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
      <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-2xl border border-charcoal/10 bg-cream p-10 text-center shadow-lg shadow-charcoal/10">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-charcoal/10 text-charcoal">
          <CheckIcon className="h-6 w-6" />
        </span>
        <h3 className="mt-5 font-display text-xl font-semibold text-charcoal">
          Thanks — we&apos;ll be in touch.
        </h3>
        <p className="mt-2 max-w-xs text-sm text-ink">
          A member of the Handpikd team will reach out within one business
          day to talk through your gifting program.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")} // lets the user go back and submit again
          className="mt-6 text-sm font-semibold text-charcoal underline-offset-4 hover:underline"
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
      className="rounded-2xl border border-charcoal/10 bg-cream p-7 shadow-lg shadow-charcoal/10 sm:p-8"
    >
      {/* 1 column on mobile, 2 columns from `sm:` up. Each field wrapper
          below is `sm:col-span-1` except the message textarea, which spans
          both columns (`sm:col-span-2`). */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-1">
          {/* `htmlFor="name"` on the <label> paired with `id="name"` on the
              <input> is what makes clicking the label focus the input —
              important both for usability and accessibility (screen
              readers announce the label when the input receives focus). */}
          <label htmlFor="name" className="mb-2 block text-xs font-semibold tracking-wide text-ink uppercase">
            Full name
          </label>
          <input id="name" name="name" type="text" autoComplete="name" required className={fieldClasses} />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="email" className="mb-2 block text-xs font-semibold tracking-wide text-ink uppercase">
            Work email
          </label>
          {/* `type="email"` gives the browser built-in "is this a validly
              formatted email address?" validation for free, and switches
              mobile keyboards to show an "@" key. */}
          <input id="email" name="email" type="email" autoComplete="email" required className={fieldClasses} />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="company" className="mb-2 block text-xs font-semibold tracking-wide text-ink uppercase">
            Company
          </label>
          <input id="company" name="company" type="text" autoComplete="organization" required className={fieldClasses} />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="phone" className="mb-2 block text-xs font-semibold tracking-wide text-ink uppercase">
            Phone <span className="normal-case text-ink/50">(optional)</span>
          </label>
          {/* No `required` here — phone is the one optional field. */}
          <input id="phone" name="phone" type="tel" autoComplete="tel" className={fieldClasses} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="message" className="mb-2 block text-xs font-semibold tracking-wide text-ink uppercase">
            What are you looking for?
          </label>
          <textarea
            id="message"
            name="message"
            rows={4}
            required
            placeholder="Tell us about the program you have in mind — recipients, timing, budget…"
            className={`${fieldClasses} resize-none`} // resize-none stops the user from manually dragging the textarea bigger/smaller
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
        <p role="alert" aria-live="polite" className="mt-4 text-sm font-semibold text-charcoal">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="mt-6 w-full sm:w-auto" showArrow>
        Send message
      </Button>
    </form>
  );
}
