import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Quotation" };

export default function AdminQuotationPage() {
  return (
    <DashboardModulePage
      title="Quotation"
      description="Create and track quotations sent to clients."
    />
  );
}
