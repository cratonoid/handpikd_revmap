import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkBoardPageClient } from "@/components/admin/work-board-page-client";

export const metadata: Metadata = { title: "Work board" };

// Suspense because the page reads ?story= (useSearchParams), which Next.js
// can't know at build time.
export default function AdminWorkBoardPage() {
  return (
    <Suspense fallback={null}>
      <WorkBoardPageClient />
    </Suspense>
  );
}
