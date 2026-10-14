import type { Metadata } from "next";
import { BackupsPageClient } from "@/components/admin/backups-page-client";

export const metadata: Metadata = { title: "Backup & Restore" };

export default function AdminBackupsPage() {
  return <BackupsPageClient />;
}
