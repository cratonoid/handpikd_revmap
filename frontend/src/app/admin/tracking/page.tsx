// Route: "/admin/tracking" — the private Porter tracking relay: paste a
// Porter tracking link, share the /track/<id> link it gives back.
import type { Metadata } from "next";
import { TrackingPageClient } from "@/components/admin/tracking-page-client";

export const metadata: Metadata = { title: "Tracking" };

export default function AdminTrackingPage() {
  return <TrackingPageClient />;
}
