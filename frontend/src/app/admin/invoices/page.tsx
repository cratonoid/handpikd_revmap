import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Invoices" };

export default function AdminInvoicesPage() {
  return (
    <DashboardModulePage
      title="Invoices"
      description="Generate, send, and track payment status of invoices."
    />
  );
}
