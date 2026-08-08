import type { Metadata } from "next";
import { ProfilePageClient } from "@/components/admin/profile-page-client";

export const metadata: Metadata = { title: "Profile" };

export default function AdminProfilePage() {
  return <ProfilePageClient />;
}
