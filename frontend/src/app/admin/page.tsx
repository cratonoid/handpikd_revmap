// Route: "/admin" — the "Analytical Dashboard" nav item's landing page.
import type { Metadata } from "next";
import { DashboardPageClient } from "@/components/admin/dashboard-page-client";

export const metadata: Metadata = {
  title: "Analytical Dashboard",
};

export default function AdminDashboardPage() {
  return <DashboardPageClient />;
}
