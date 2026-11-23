"use client";

// ---------------------------------------------------------------------------
// <CatalogueTabs> — "Catalogues | Price Lists" at the top of both pages
// ---------------------------------------------------------------------------
// Price Lists lives inside Catalogues (navParent in lib/access.ts) but keeps
// its own URL and its own role permission, so each tab is a link to its
// page and only shows for a role that can open it.
import { useEffect, useState } from "react";
import Link from "next/link";
import { canAccess, fetchMyAccess, type MyAccess, type SectionKey } from "@/lib/access";
import styles from "@/styles/dashboard.module.css";

const TABS: { key: SectionKey; label: string; href: string }[] = [
  { key: "catalogues", label: "Catalogues", href: "/admin/catalogues" },
  { key: "price_lists", label: "Price Lists", href: "/admin/price-lists" },
];

export function CatalogueTabs({ current }: { current: SectionKey }) {
  const [access, setAccess] = useState<MyAccess | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyAccess()
      .then((data) => {
        if (!cancelled) setAccess(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Until access loads (or if it fails) only the current tab is certain.
  const tabs = TABS.filter((tab) => tab.key === current || (access !== null && canAccess(access, tab.key)));
  if (tabs.length < 2) return null;

  return (
    <div className={styles.viewToggle} role="tablist" aria-label="Catalogues or price lists">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={tab.key === current}
          className={`${styles.viewToggleButton} ${tab.key === current ? styles.viewToggleButtonActive : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
