import type { Metadata } from "next";
import { QuotationsTab } from "@/components/admin/quotations-tab";

export const metadata: Metadata = { title: "Quotation" };

export default function AdminQuotationPage() {
  return <QuotationsTab />;
}
