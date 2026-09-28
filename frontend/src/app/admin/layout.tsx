// Wraps every /admin/** route in the sidebar + top bar shell, and gates it to
// the "admin" role (see components/dashboard-shell.tsx for the redirect
// logic). A Server Component so it can pass `children` straight through to
// the Client Component shell without needing "use client" itself.
//
// Also what makes /admin installable as a home-screen app: the manifest link
// lives here rather than in the root layout, so only admin pages advertise
// it and the public storefront can't be "installed" as the admin app. The
// manifest's scope is "/" rather than "/admin" because an expired session
// bounces to /login, and leaving the scope would make the installed app pop
// a browser URL bar over the login screen.
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  manifest: "/admin.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Handpikd",
    statusBarStyle: "default",
  },
  // Admin pages are behind a login and have nothing for search engines.
  robots: { index: false, follow: false },
};

// themeColor tints the phone's status bar / browser chrome to the dashboard's
// cream background instead of the default white. viewportFit: "cover" lets
// the installed app use the whole screen; the top bar, tab bar and modals
// pad themselves clear of the notch and home indicator with
// env(safe-area-inset-*) (see the phone layout section of
// dashboard.module.css).
export const viewport: Viewport = {
  themeColor: "#f5f1ed",
  viewportFit: "cover",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PwaRegister />
      <DashboardShell role="admin">{children}</DashboardShell>
    </>
  );
}
