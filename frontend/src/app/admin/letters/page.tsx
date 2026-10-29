import type { Metadata } from "next";
import { LettersTab } from "@/components/admin/letters-tab";

export const metadata: Metadata = { title: "Letters" };

export default function AdminLettersPage() {
  return <LettersTab />;
}
