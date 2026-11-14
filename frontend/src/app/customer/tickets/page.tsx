import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomerTicketsPageClient } from "@/components/customer/tickets-page-client";

export const metadata: Metadata = { title: "Support tickets" };

// Suspense because the page reads ?ticket= (useSearchParams), which Next.js
// can't know at build time.
export default function CustomerTicketsPage() {
  return (
    <Suspense fallback={null}>
      <CustomerTicketsPageClient />
    </Suspense>
  );
}
