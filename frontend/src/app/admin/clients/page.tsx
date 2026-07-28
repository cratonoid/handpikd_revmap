import type { Metadata } from "next";
import { DashboardModulePage } from "@/components/dashboard-placeholder";

export const metadata: Metadata = { title: "Clients" };

export default function AdminClientsPage() {
  return (
    <DashboardModulePage
      title="Clients"
      description="View and manage client accounts and their points of contact."
    />
  );
}
