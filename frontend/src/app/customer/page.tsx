// Route: "/customer" — the "Dashboard" nav item's landing page.
import type { Metadata } from "next";
import { CustomerDashboardPageClient } from "@/components/customer/dashboard-page-client";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function CustomerDashboardPage() {
  return <CustomerDashboardPageClient />;
}
