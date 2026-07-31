import type { Metadata } from "next";
import { ProductsPageClient } from "@/components/admin/products-page-client";

export const metadata: Metadata = { title: "Products" };

export default function AdminProductsPage() {
  return <ProductsPageClient />;
}
