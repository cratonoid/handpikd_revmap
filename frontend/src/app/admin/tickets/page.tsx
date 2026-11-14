import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketsPageClient } from "@/components/admin/tickets-page-client";

export const metadata: Metadata = { title: "Tickets" };

// Suspense because the page reads ?ticket= (useSearchParams), which Next.js
// can't know at build time.
export default function AdminTicketsPage() {
  return (
    <Suspense fallback={null}>
      <TicketsPageClient />
    </Suspense>
  );
}
