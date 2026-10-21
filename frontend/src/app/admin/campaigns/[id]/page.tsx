// Route: "/admin/campaigns/[id]" — one campaign: the whole Database listed
// with where each contact stands in it, and mail sent from here. Reached
// from /admin/campaigns. `params` arrives as a Promise in the App Router.
import type { Metadata } from "next";
import { CampaignDetailPageClient } from "@/components/admin/campaign-detail-page-client";

export const metadata: Metadata = { title: "Campaign" };

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminCampaignPage({ params }: PageProps) {
  const { id } = await params;
  return <CampaignDetailPageClient campaignId={Number(id)} />;
}
