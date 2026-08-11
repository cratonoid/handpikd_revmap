import type { Metadata } from "next";
import { InvoicesPageClient } from "@/components/admin/invoices-page-client";

export const metadata: Metadata = { title: "Invoices" };

export default function AdminInvoicesPage() {
  return <InvoicesPageClient />;
}
