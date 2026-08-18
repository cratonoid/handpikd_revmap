// Route: "/admin/orders/sales/[id]/details" — the costing sheet behind a
// single sales order, reached from the "Add details" button on the Sales
// orders tab of /admin/orders (components/admin/sales-orders-tab.tsx).
//
// A page rather than a modal: the sheet carries ~20 figures per product,
// which needs more room than the order form popup has.
//
// Server Component wrapper only — the sheet itself is fully interactive
// (every figure recalculates as the admin types), so all of it lives in the
// Client Component below. `params` arrives as a Promise in the App Router
// and has to be awaited even for this one segment.
import type { Metadata } from "next";
import { SalesOrderCostingPageClient } from "@/components/admin/sales-order-costing-page-client";

export const metadata: Metadata = { title: "Sales order details" };

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminSalesOrderDetailsPage({ params }: PageProps) {
  const { id } = await params;
  return <SalesOrderCostingPageClient salesOrderId={Number(id)} />;
}
