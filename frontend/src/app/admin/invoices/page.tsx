import type { Metadata } from "next";
import { InvoicesTab } from "@/components/admin/invoices-tab";

export const metadata: Metadata = { title: "Invoices" };

export default function AdminInvoicesPage() {
  return <InvoicesTab />;
}
