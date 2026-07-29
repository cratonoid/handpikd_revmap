import type { Metadata } from "next";
import { ClientsPageClient } from "@/components/admin/clients-page-client";

export const metadata: Metadata = { title: "Clients" };

export default function AdminClientsPage() {
  return <ClientsPageClient />;
}
