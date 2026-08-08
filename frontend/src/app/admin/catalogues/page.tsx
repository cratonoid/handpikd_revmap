import type { Metadata } from "next";
import { CataloguesPageClient } from "@/components/admin/catalogues-page-client";

export const metadata: Metadata = { title: "Catalogues" };

export default function AdminCataloguesPage() {
  return <CataloguesPageClient />;
}
