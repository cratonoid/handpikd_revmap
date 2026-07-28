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
// sessionStorage isn't available while this renders on the server, so the
// stored role is read via useSyncExternalStore rather than a plain
// useState+useEffect pair — its getServerSnapshot/getSnapshot split is
// exactly React's built-in tool for "browser-only value that must not
// mismatch the server-rendered HTML," and it reconciles to the real value
// synchronously before paint instead of needing setState inside an effect.
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import {
  ArchiveBoxIcon,
  ChartBarIcon,
  CubeIcon,
  DocumentTextIcon,
  HomeIcon,
  LogoutIcon,
  ReceiptIcon,
  ShoppingCartIcon,
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
    { label: "Orders", href: "/admin/orders", icon: ShoppingCartIcon },
    { label: "Inventory", href: "/admin/inventory", icon: ArchiveBoxIcon },
    { label: "Products", href: "/admin/products", icon: CubeIcon },
    { label: "Categories", href: "/admin/categories", icon: TagIcon },
    { label: "Quotation", href: "/admin/quotation", icon: DocumentTextIcon },
    { label: "Invoices", href: "/admin/invoices", icon: ReceiptIcon },
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

// The stored role never changes from outside this component during its
// lifetime (it's only ever set at login, before the dashboard mounts), so
// the "subscribe" half of useSyncExternalStore has nothing to listen for.
function subscribeToNothing() {
  return () => {};
}

function getServerRoleSnapshot(): UserRole | null {
  return null;
}

export function DashboardShell({ role, children }: { role: UserRole; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const storedRole = useSyncExternalStore(subscribeToNothing, getUserRole, getServerRoleSnapshot);
  const authorized = storedRole === role;

  useEffect(() => {
    if (!authorized) {
      router.replace("/login");
    }
  }, [authorized, router]);

  function handleLogout() {
    clearSession();
    router.push("/login");
  }

  if (!authorized) {
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
