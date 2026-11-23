"use client";

// ---------------------------------------------------------------------------
// <PhoneAlertsButton> — turns phone alerts (Web Push, lib/push.ts) on or off
// for this phone and whoever is signed in. Shown on the Work board, whose
// assignments and Active-task reminders are what it delivers.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import styles from "@/styles/dashboard.module.css";

const HINT: Partial<Record<PushState, string>> = {
  "install-first": "On iPhone: tap Share → Add to Home Screen, open the app from there, then turn on phone alerts.",
  blocked: "Alerts are blocked for this site. Allow notifications in your phone or browser settings, then reload.",
  unsupported: "This browser can't receive phone alerts. Try Chrome, or the installed app.",
};

export function PhoneAlertsButton() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPushState()
      .then((value) => !cancelled && setState(value))
      .catch(() => !cancelled && setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null) return null;

  async function toggle() {
    if (state !== "on" && state !== "off") {
      setShowHint((shown) => !shown);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setState(state === "on" ? await disablePush() : await enablePush());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const hint = HINT[state];
  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => void toggle()} disabled={busy}>
        {busy ? "…" : state === "on" ? "🔔 Phone alerts on" : "🔕 Turn on phone alerts"}
      </Button>
      {(error || (showHint && hint)) && (
        <p role="status" className={error ? styles.formError : styles.formHint}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
