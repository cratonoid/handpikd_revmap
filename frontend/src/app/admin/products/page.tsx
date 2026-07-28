import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Products" };

export default function AdminProductsPage() {
  return (
    <DashboardModulePage
      title="Products"
      description="Manage the product catalogue, pricing, and images."
    />
  );
}
