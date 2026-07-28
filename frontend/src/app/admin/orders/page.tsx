import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return (
    <DashboardModulePage
      title="Orders"
      description="Track purchase and sales orders from placement through fulfillment."
    />
  );
}
