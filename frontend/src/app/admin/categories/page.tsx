import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Categories" };

export default function AdminCategoriesPage() {
  return (
    <DashboardModulePage
      title="Categories"
      description="Organize products into categories for the catalogue."
    />
  );
}
