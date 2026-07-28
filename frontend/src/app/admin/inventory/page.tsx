import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Inventory" };

export default function AdminInventoryPage() {
  return (
    <DashboardModulePage
      title="Inventory"
      description="Monitor stock levels across products and warehouses."
    />
  );
}
