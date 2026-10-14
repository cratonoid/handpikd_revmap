import type { Metadata } from "next";
import { PriceListsPageClient } from "@/components/admin/price-lists-page-client";

export const metadata: Metadata = { title: "Price Lists" };

export default function AdminPriceListsPage() {
  return <PriceListsPageClient />;
}
