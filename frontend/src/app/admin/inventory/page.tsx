import type { Metadata } from "next";
import { InventoryPageClient } from "@/components/admin/inventory-page-client";

export const metadata: Metadata = { title: "Inventory" };

export default function AdminInventoryPage() {
  return <InventoryPageClient />;
}
