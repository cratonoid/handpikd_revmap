import type { Metadata } from "next";
import { ProductInquiriesPageClient } from "@/components/admin/product-inquiries-page-client";

export const metadata: Metadata = { title: "Product Inquiries" };

export default function AdminProductInquiriesPage() {
  return <ProductInquiriesPageClient />;
}
