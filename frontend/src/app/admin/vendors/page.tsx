import type { Metadata } from "next";
import { VendorsPageClient } from "@/components/admin/vendors-page-client";

export const metadata: Metadata = { title: "Vendors" };

export default function AdminVendorsPage() {
  return <VendorsPageClient />;
}
