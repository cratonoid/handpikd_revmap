"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { CheckIcon } from "@/components/icons";

type Status = "idle" | "success";

const fieldClasses =
  "w-full rounded-xl border border-border bg-cream px-4 py-3 text-sm text-charcoal placeholder:text-ink/40 outline-none transition-colors focus:border-charcoal";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

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
    form.reset();
  }

  if (status === "success") {
    return (
      <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-2xl border border-charcoal/10 bg-cream p-10 text-center shadow-sm shadow-charcoal/5">
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
          onClick={() => setStatus("idle")}
          className="mt-6 text-sm font-semibold text-charcoal underline-offset-4 hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate={false}
      onSubmit={handleSubmit}
      className="rounded-2xl border border-charcoal/10 bg-cream p-7 shadow-sm shadow-charcoal/5 sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-1">
          <label htmlFor="name" className="mb-2 block text-xs font-semibold tracking-wide text-ink uppercase">
            Full name
          </label>
          <input id="name" name="name" type="text" autoComplete="name" required className={fieldClasses} />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="email" className="mb-2 block text-xs font-semibold tracking-wide text-ink uppercase">
            Work email
          </label>
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
            className={`${fieldClasses} resize-none`}
          />
        </div>
      </div>

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
