// Wraps every /customer/** route in the sidebar + top bar shell, and gates
// it to the "customer" role (see components/dashboard-shell.tsx).
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return <DashboardShell role="customer">{children}</DashboardShell>;
}
