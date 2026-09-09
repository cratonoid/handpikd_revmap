import type { Metadata } from "next";
import { CustomerInvoicesPageClient } from "@/components/customer/invoices-page-client";

export const metadata: Metadata = { title: "Invoices" };

export default function CustomerInvoicesPage() {
  return <CustomerInvoicesPageClient />;
}
