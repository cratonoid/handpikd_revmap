import type { Metadata } from "next";
import { AccountsPageClient } from "@/components/admin/accounts-page-client";

export const metadata: Metadata = { title: "Accounts" };

export default function AdminAccountsPage() {
  return <AccountsPageClient />;
}
