import type { Metadata } from "next";
import { CampaignsPageClient } from "@/components/admin/campaigns-page-client";

export const metadata: Metadata = { title: "Campaigns" };

export default function AdminCampaignsPage() {
  return <CampaignsPageClient />;
}
