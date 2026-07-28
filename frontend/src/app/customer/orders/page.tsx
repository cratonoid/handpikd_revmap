import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Orders" };

export default function CustomerOrdersPage() {
  return (
    <DashboardModulePage
      title="Orders"
      description="View the status and history of your orders."
    />
  );
}
