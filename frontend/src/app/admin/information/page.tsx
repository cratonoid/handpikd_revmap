import type { Metadata } from "next";
import { InformationPageClient } from "@/components/admin/information-page-client";

export const metadata: Metadata = { title: "Information" };

export default function AdminInformationPage() {
  return <InformationPageClient />;
}
