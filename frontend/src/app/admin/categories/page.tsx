import type { Metadata } from "next";
import { CategoriesPageClient } from "@/components/admin/categories-page-client";

export const metadata: Metadata = { title: "Categories" };

export default function AdminCategoriesPage() {
  return <CategoriesPageClient />;
}
