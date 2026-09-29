import type { Metadata } from "next";
import { UsersPageClient } from "@/components/admin/users-page-client";

export const metadata: Metadata = { title: "Users & Roles" };

export default function AdminUsersPage() {
  return <UsersPageClient />;
}
