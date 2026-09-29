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
// Role check: first a purely client-side guard against sessionStorage (see
// lib/auth.ts), so an admin page never flashes on screen in a customer's
// tab. Team accounts then fetch which sections their role grants (see
// lib/access.ts): the sidebar and tab bar show only those, and a page
// outside them renders a "no access" notice instead of its content. The
// backend enforces the same sections on every admin endpoint
// (require_section in backend/app/api/deps.py) — this is presentation only.
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
  MailIcon,
  MenuIcon,
  ReceiptIcon,
  ShieldUserIcon,
  ShoppingCartIcon,
  StorefrontIcon,
  TagIcon,
  UsersIcon,
  XMarkIcon,
} from "@/components/icons";
import { useResponsiveTables } from "@/components/use-responsive-tables";
import {
  ADMIN_SECTIONS,
  canAccess,
  fetchMyAccess,
  isSectionPath,
  sectionForPath,
  type MyAccess,
  type SectionKey,
} from "@/lib/access";
import { clearSession, getUserRole, type UserRole } from "@/lib/auth";
import styles from "@/styles/dashboard.module.css";

type Icon = (props: { className?: string }) => React.JSX.Element;

type NavItem = {
  label: string;
  href: string;
  icon: Icon;
  // Admin items only: the section a role must grant for the link to show.
  section?: SectionKey;
};

const SECTION_ICONS: Record<SectionKey, Icon> = {
  dashboard: ChartBarIcon,
  clients: UsersIcon,
  vendors: StorefrontIcon,
  database: DatabaseIcon,
  emails: MailIcon,
  orders: ShoppingCartIcon,
  invoices: ReceiptIcon,
  accounts: LedgerIcon,
  inventory: ArchiveBoxIcon,
  products: CubeIcon,
  categories: TagIcon,
  catalogues: DiaryIcon,
  inquiry_form: GiftBoxIcon,
  product_inquiries: InboxIcon,
  quotation: DocumentTextIcon,
  profile: IdCardIcon,
  users: ShieldUserIcon,
};

const NAV_ITEMS: Record<UserRole, NavItem[]> = {
  admin: ADMIN_SECTIONS.map((section) => ({
    label: section.label,
    href: section.href,
    icon: SECTION_ICONS[section.key],
    section: section.key,
  })),
  customer: [
    { label: "Dashboard", href: "/customer", icon: HomeIcon },
    { label: "Invoices", href: "/customer/invoices", icon: ReceiptIcon },
  ],
};

// The phone-only bottom tab bar: the screens reached for most often on the go,
// one tap away instead of two through the drawer. Everything else (and these
// too) stays in the drawer. Customers have only two destinations, so the
// drawer alone serves them and they get no tab bar.
const TAB_ITEMS: Partial<Record<UserRole, NavItem[]>> = {
  admin: [
    { label: "Dashboard", href: "/admin", icon: ChartBarIcon, section: "dashboard" },
    { label: "Orders", href: "/admin/orders", icon: ShoppingCartIcon, section: "orders" },
    { label: "Invoices", href: "/admin/invoices", icon: ReceiptIcon, section: "invoices" },
    { label: "Inventory", href: "/admin/inventory", icon: ArchiveBoxIcon, section: "inventory" },
    { label: "Inquiries", href: "/admin/inquiry-form", icon: GiftBoxIcon, section: "inquiry_form" },
  ],
};

// A section's root link also stays lit on its sub-pages (the sales order
// details page under /admin/orders) — see isSectionPath in lib/access.ts.
const isActiveHref = isSectionPath;

// Customers have no roles, so `access` is only ever set for team accounts.
function isAllowed(item: NavItem, access: MyAccess | null) {
  return !item.section || !access || canAccess(access, item.section);
}

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
  // The content pane, whose tables useResponsiveTables turns into cards on
  // a phone when they don't fit.
  const contentRef = useRef<HTMLElement>(null);

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

  useResponsiveTables(contentRef, styles.tableCellPrimary, status === "authorized");

  useEffect(() => {
    if (status === "unauthorized") {
      router.replace("/login");
    }
  }, [status, router]);

  // Team accounts only: which sections their role grants. Re-fetched on
  // every navigation (the shell itself stays mounted between admin pages),
  // so a role edited by someone else applies without signing out. Only the
  // first load holds the page back — later ones keep the last answer on
  // screen until the new one arrives.
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [accessError, setAccessError] = useState(false);

  useEffect(() => {
    if (role !== "admin" || status !== "authorized") return;
    let cancelled = false;

    fetchMyAccess()
      .then((data) => {
        if (cancelled) return;
        setAccess(data);
        setAccessError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAccessError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [role, status, pathname]);

  const currentSection = role === "admin" ? sectionForPath(pathname) : undefined;
  const sectionBlocked = !!access && !!currentSection && !canAccess(access, currentSection.key);
  // /admin is where login lands everyone, so a role without the dashboard
  // is sent on to its first section instead of being shown a "no access"
  // notice on arrival.
  const landingHref =
    sectionBlocked && pathname === "/admin"
      ? ADMIN_SECTIONS.find((section) => canAccess(access, section.key))?.href
      : undefined;

  useEffect(() => {
    if (landingHref) {
      router.replace(landingHref);
    }
  }, [landingHref, router]);

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

  if (status !== "authorized" || (role === "admin" && !access && !accessError)) {
    return null;
  }

  const navItems = NAV_ITEMS[role].filter((item) => isAllowed(item, access));
  // What the hamburger sits next to on a phone: the label of the page you are
  // actually on. The top bar otherwise shows only the logo, which says nothing
  // about where in the dashboard you are once the horizontal pill strip (which
  // used to answer that) is gone.
  const activeItem = NAV_ITEMS[role].find((item) => isActiveHref(pathname, item.href));
  const allowedTabItems = TAB_ITEMS[role]?.filter((item) => isAllowed(item, access));
  const tabItems = allowedTabItems && allowedTabItems.length > 0 ? allowedTabItems : undefined;
  const roleLabel = access?.roleName || ROLE_LABEL[role];

  let content: ReactNode = children;
  if (!access && accessError) {
    content = (
      <p className={styles.formError}>Couldn&apos;t load your permissions. Please refresh the page to try again.</p>
    );
  } else if (landingHref) {
    content = null;
  } else if (sectionBlocked) {
    content =
      navItems.length === 0 ? (
        <div className={styles.noAccessNotice}>
          <h1 className={`${styles.pageHeading} ${styles.pageHeadingKeep}`}>No sections yet</h1>
          <p className={styles.pageSubtext}>
            Your role doesn&apos;t include any sections. Ask an administrator to give it access on Users &amp; Roles.
          </p>
        </div>
      ) : (
        <div className={styles.noAccessNotice}>
          <h1 className={`${styles.pageHeading} ${styles.pageHeadingKeep}`}>No access</h1>
          <p className={styles.pageSubtext}>
            Your role doesn&apos;t include {currentSection?.label}. Ask an administrator if you need it.
          </p>
          <Link href={navItems[0].href} className={styles.noAccessLink}>
            Go to {navItems[0].label}
          </Link>
        </div>
      );
  }

  return (
    <div className={`${styles.shell} ${tabItems ? styles.shellWithTabs : ""}`}>
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
          <span className={styles.roleBadge}>{roleLabel}</span>
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
            const isActive = isActiveHref(pathname, item.href);
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
        <main ref={contentRef} className={styles.content}>
          <div className={styles.contentInner}>{content}</div>
        </main>
      </div>

      {/* Hidden at >= 768px, where the sidebar shows every destination. */}
      {tabItems && (
        <nav className={styles.tabBar} aria-label="Quick navigation">
          {tabItems.map((item) => {
            const isActive = isActiveHref(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.tabLink} ${isActive ? styles.tabLinkActive : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className={styles.tabIcon}>
                  <Icon className="h-5 w-5" />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
