// Route: "/track/[id]" — a customer's live view of their delivery, from a
// link made on /admin/tracking. Public, no login. Shows only what
// backend/app/api/routes/tracking.py's /track API returns: status, ETA,
// driver and drop point. Never indexed. `params` arrives as a Promise in
// the App Router.
import type { Metadata } from "next";
import { TrackPageClient } from "@/components/track/track-page-client";

export const metadata: Metadata = {
  title: "Track your delivery",
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function TrackPage({ params }: PageProps) {
  const { id } = await params;
  return <TrackPageClient id={id} />;
}
