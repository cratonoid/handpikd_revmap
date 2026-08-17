"use client";

// ---------------------------------------------------------------------------
// <DashboardShell> — sidebar + top bar chrome for /admin and /customer
// ---------------------------------------------------------------------------
// Both role dashboards share this one shell (nav list on the left, a top bar
// with a role badge + logout on top, page content on the right) instead of
// each route re-implementing the same layout. The nav items themselves are
// fixed per role rather than passed in as a prop, because passing icon
// components as props would cross the Server → Client Component boundary
// (app/admin/layout.tsx and app/customer/layout.tsx are Server Components),
// which only works for serializable data and JSX, not arbitrary functions.
//
// Role check: this is a purely client-side guard against sessionStorage
// (see lib/auth.ts) — there's no backend call yet, so it only prevents an
// admin-only page from flashing on screen for a customer's tab, not a
// determined attacker. Real enforcement happens once each module wires up
// to its API.
//
// This used to read the stored role via useSyncExternalStore with a
// getServerSnapshot that always returned null (sessionStorage isn't
// available on the server). That meant the very FIRST commit — server
// render and the initial client hydration alike — always saw "no role"
// and was therefore always "unauthorized", and its useEffect fired
// router.replace("/login") immediately off that first commit. React does
// correct the mismatch with a follow-up re-render once the real
// sessionStorage value is known, but that happens one commit too late —
// the redirect from the first commit had already fired. Net effect: ANY
// fresh/full page load of /admin or /customer bounced straight to /login
// even with a perfectly valid session; it only "worked" when navigating
// here client-side (e.g. right after logging in), which never hit that
// first mismatched commit.
//
// Fix: don't give this value a server snapshot to mismatch against at
// all. `status` starts as "checking" identically on server and first
// client render (a plain literal, not read from storage), so there's
// nothing to correct — the role is only read inside an effect, which by
// definition runs after hydration has already settled.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import {
  ArchiveBoxIcon,
  ChartBarIcon,
  CubeIcon,
  DiaryIcon,
  DocumentTextIcon,
  GiftBoxIcon,
  HomeIcon,
  IdCardIcon,
  InboxIcon,
  LogoutIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  StorefrontIcon,
  TagIcon,
  UsersIcon,
} from "@/components/icons";
import { clearSession, getUserRole, type UserRole } from "@/lib/auth";
import styles from "@/styles/dashboard.module.css";

type NavItem = {
  label: string;
  href: string;
  icon: (props: { className?: string }) => React.JSX.Element;
};

const NAV_ITEMS: Record<UserRole, NavItem[]> = {
  admin: [
    { label: "Analytical Dashboard", href: "/admin", icon: ChartBarIcon },
    { label: "Clients", href: "/admin/clients", icon: UsersIcon },
    { label: "Vendors", href: "/admin/vendors", icon: StorefrontIcon },
    { label: "Orders", href: "/admin/orders", icon: ShoppingCartIcon },
    { label: "Invoices", href: "/admin/invoices", icon: ReceiptIcon },
    { label: "Inventory", href: "/admin/inventory", icon: ArchiveBoxIcon },
    { label: "Products", href: "/admin/products", icon: CubeIcon },
    { label: "Categories", href: "/admin/categories", icon: TagIcon },
    { label: "Catalogues", href: "/admin/catalogues", icon: DiaryIcon },
    { label: "Hamper Inquiry Form", href: "/admin/inquiry-form", icon: GiftBoxIcon },
    { label: "Product Inquiries", href: "/admin/product-inquiries", icon: InboxIcon },
    { label: "Quotation", href: "/admin/quotation", icon: DocumentTextIcon },
    { label: "Profile", href: "/admin/profile", icon: IdCardIcon },
  ],
  customer: [
    { label: "Dashboard", href: "/customer", icon: HomeIcon },
    { label: "Orders", href: "/customer/orders", icon: ShoppingCartIcon },
  ],
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  customer: "Customer",
};

type AuthStatus = "checking" | "authorized" | "unauthorized";

export function DashboardShell({ role, children }: { role: UserRole; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>("checking");

  // Runs once, after mount — i.e. only once hydration has already
  // settled, so there's no earlier "unauthorized" commit for a redirect
  // to have fired from. The setState is deferred into a microtask
  // callback (rather than called synchronously in the effect body) per
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    queueMicrotask(() => {
      setStatus(getUserRole() === role ? "authorized" : "unauthorized");
    });
  }, [role]);

  useEffect(() => {
    if (status === "unauthorized") {
      router.replace("/login");
    }
  }, [status, router]);

  function handleLogout() {
    clearSession();
    router.push("/login");
  }

  if (status !== "authorized") {
    return null;
  }

  const navItems = NAV_ITEMS[role];

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href={role === "admin" ? "/admin" : "/customer"} className={styles.topbarLogo}>
          <Logo compact />
        </Link>
        <div className={styles.topbarRight}>
          <span className={styles.roleBadge}>{ROLE_LABEL[role]}</span>
          <button type="button" onClick={handleLogout} className={styles.logoutButton}>
            <LogoutIcon className="h-4 w-4" />
            Log out
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="Dashboard navigation">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
