// Wraps every /admin/** route in the sidebar + top bar shell, and gates it to
// the "admin" role (see components/dashboard-shell.tsx for the redirect
// logic). A Server Component so it can pass `children` straight through to
// the Client Component shell without needing "use client" itself.
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <DashboardShell role="admin">{children}</DashboardShell>;
}
