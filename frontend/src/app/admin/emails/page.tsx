import type { Metadata } from "next";
import { EmailsPageClient } from "@/components/admin/emails-page-client";

export const metadata: Metadata = { title: "Emails" };

export default function AdminEmailsPage() {
  return <EmailsPageClient />;
}
