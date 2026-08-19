import type { Metadata } from "next";
import { DatabasePageClient } from "@/components/admin/database-page-client";

export const metadata: Metadata = { title: "Database" };

export default function AdminDatabasePage() {
  return <DatabasePageClient />;
}
