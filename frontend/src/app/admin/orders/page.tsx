import type { Metadata } from "next";
import { OrdersPageClient } from "@/components/admin/orders-page-client";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return <OrdersPageClient />;
}
