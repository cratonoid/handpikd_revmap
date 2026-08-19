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
// Responsive behaviour: at >= 768px the nav is a permanent column beside the
// content. Below that it becomes a slide-in drawer opened by the hamburger
// button in the top bar. It used to be a horizontal strip of pills above the
// content that scrolled sideways — with 13 admin items that meant most of the
// app was hidden behind a sideways swipe, and the strip still ate a chunk of
// the little vertical room a phone has. The drawer costs one tap but shows
// every destination at once, as a readable vertical list.
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
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import {
  ArchiveBoxIcon,
  ChartBarIcon,
  CubeIcon,
  DatabaseIcon,
  DiaryIcon,
  DocumentTextIcon,
  GiftBoxIcon,
  HomeIcon,
  IdCardIcon,
  InboxIcon,
  LedgerIcon,
  LogoutIcon,
  MenuIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  StorefrontIcon,
  TagIcon,
  UsersIcon,
  XMarkIcon,
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
    { label: "Database", href: "/admin/database", icon: DatabaseIcon },
    { label: "Orders", href: "/admin/orders", icon: ShoppingCartIcon },
    { label: "Invoices", href: "/admin/invoices", icon: ReceiptIcon },
    { label: "Accounts", href: "/admin/accounts", icon: LedgerIcon },
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

// Matches the min-width: 768px breakpoint the sidebar/drawer rules in
// dashboard.module.css switch on. Kept as a constant so the one place JS
// needs to know about the breakpoint (closing the drawer when a rotation or
// window resize crosses into desktop, where the drawer no longer exists)
// can't drift away from the stylesheet.
const DESKTOP_QUERY = "(min-width: 768px)";

type AuthStatus = "checking" | "authorized" | "unauthorized";

export function DashboardShell({ role, children }: { role: UserRole; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [navOpen, setNavOpen] = useState(false);

  // The hamburger, so focus can be handed back to it when the drawer closes
  // — otherwise closing with Escape or the X button drops a keyboard user
  // back at the top of the document.
  const navToggleRef = useRef<HTMLButtonElement>(null);
  // The drawer panel itself, focused on open so the next Tab lands inside the
  // nav rather than continuing from wherever focus was in the page.
  const navPanelRef = useRef<HTMLElement>(null);

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

  // While the drawer is open: Escape closes it, and the page behind it is
  // frozen so a scroll gesture that starts on the dimmed backdrop doesn't
  // slide the content underneath. Both are torn down the moment it closes,
  // so nothing here runs (or holds body scroll hostage) on desktop.
  useEffect(() => {
    if (!navOpen) return;

    // Not closeNav() itself: that function is rebuilt on every render, and
    // this effect only re-runs when navOpen flips, so the listener would go
    // on holding a stale copy. The two statements it does are inlined here
    // instead — navToggleRef is a ref, so it is always current.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavOpen(false);
        navToggleRef.current?.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    navPanelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  // Growing past the breakpoint (rotating a tablet, dragging a desktop window
  // wider) turns the drawer back into the permanent sidebar via CSS. Clearing
  // the state here keeps React's idea of "open" from lingering — otherwise
  // shrinking back down would reveal a drawer nobody asked to open.
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);

    function onChange(event: MediaQueryListEvent) {
      if (event.matches) setNavOpen(false);
    }

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function closeNav() {
    setNavOpen(false);
    navToggleRef.current?.focus();
  }

  function handleLogout() {
    clearSession();
    router.push("/login");
  }

  if (status !== "authorized") {
    return null;
  }

  const navItems = NAV_ITEMS[role];
  // What the hamburger sits next to on a phone: the label of the page you are
  // actually on. The top bar otherwise shows only the logo, which says nothing
  // about where in the dashboard you are once the horizontal pill strip (which
  // used to answer that) is gone.
  const activeItem = navItems.find((item) => item.href === pathname);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          {/* Hidden at >= 768px, where .sidebar is always on screen. */}
          <button
            type="button"
            ref={navToggleRef}
            className={styles.navToggle}
            aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={navOpen}
            aria-controls="dashboard-nav"
            onClick={() => setNavOpen((open) => !open)}
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <Link href={role === "admin" ? "/admin" : "/customer"} className={styles.topbarLogo}>
            <Logo compact />
          </Link>

          {activeItem && <span className={styles.topbarSection}>{activeItem.label}</span>}
        </div>

        <div className={styles.topbarRight}>
          <span className={styles.roleBadge}>{ROLE_LABEL[role]}</span>
          {/* aria-label rather than relying on the text: .logoutButtonLabel is
              display: none under 420px, which would otherwise leave this an
              unnamed icon button on the narrowest phones. */}
          <button type="button" onClick={handleLogout} className={styles.logoutButton} aria-label="Log out">
            <LogoutIcon className="h-4 w-4" />
            <span className={styles.logoutButtonLabel}>Log out</span>
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {/* The dim behind the open drawer. Rendered unconditionally (rather
            than behind `navOpen &&`) so it can fade both in AND out — an
            element that only exists while open has nothing to animate away
            from. It is display: none at >= 768px, and pointer-events: none
            while closed, so it never intercepts a click on the page below. */}
        <div
          className={`${styles.navBackdrop} ${navOpen ? styles.navBackdropOpen : ""}`}
          onClick={closeNav}
          aria-hidden="true"
        />

        <nav
          id="dashboard-nav"
          ref={navPanelRef}
          tabIndex={-1}
          className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ""}`}
          aria-label="Dashboard navigation"
        >
          {/* Drawer-only chrome — display: none at >= 768px, where the sidebar
              is permanent furniture and needs no title or close button. */}
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarHeaderTitle}>Menu</span>
            <button
              type="button"
              className={styles.sidebarCloseButton}
              onClick={closeNav}
              aria-label="Close navigation menu"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                // Closes the drawer on the way out. Same approach as the
                // marketing site's hamburger (components/header.tsx) — and
                // while the drawer is open it and its backdrop cover the
                // whole screen, so tapping a link here is the only way to
                // navigate from this state anyway.
                onClick={() => setNavOpen(false)}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* .content is the scroll container (so the top bar and sidebar stay
            put); .contentInner holds the centred max-width column, which
            keeps the scrollbar at the edge of the pane rather than floating
            mid-screen on a wide monitor. */}
        <main className={styles.content}>
          <div className={styles.contentInner}>{children}</div>
        </main>
      </div>
    </div>
  );
}
