import type { Metadata } from "next";
import { Suspense } from "react";
import { InquiriesPageClient } from "@/components/admin/inquiries-page-client";

export const metadata: Metadata = { title: "Inquiries" };

// Suspense because the page reads ?inquiry= (useSearchParams), which Next.js
// can't know at build time.
export default function AdminInquiriesPage() {
  return (
    <Suspense fallback={null}>
      <InquiriesPageClient />
    </Suspense>
  );
}
