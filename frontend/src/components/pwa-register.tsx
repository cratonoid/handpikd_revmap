"use client";

// ---------------------------------------------------------------------------
// <PwaRegister> — registers the admin app's service worker (public/sw.js)
// ---------------------------------------------------------------------------
// Rendered only by app/admin/layout.tsx, and registered with scope "/admin",
// so the public storefront never gets a service worker: the admin app's
// offline page has no business intercepting a visitor's navigation on
// /products. Renders nothing.
//
// updateViaCache: "none" makes the browser re-check sw.js itself on every
// load instead of trusting its HTTP cache, so an edited worker reaches
// installed phones on their next launch.
import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/admin", updateViaCache: "none" }).catch(() => {
      // Not fatal: the dashboard works the same without it, it just shows the
      // browser's own offline error instead of ours.
    });
  }, []);

  return null;
}
