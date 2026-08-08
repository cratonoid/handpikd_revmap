import type { Metadata } from "next";
import { InquiryFormPageClient } from "@/components/admin/inquiry-form-page-client";

export const metadata: Metadata = { title: "Hamper Inquiry Form" };

export default function AdminInquiryFormPage() {
  return <InquiryFormPageClient />;
}
