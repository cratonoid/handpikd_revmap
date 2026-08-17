"use client";

// ---------------------------------------------------------------------------
// <Header> — sticky top navigation bar
// ---------------------------------------------------------------------------
// Rendered at the top of every page. Three behaviors happen here, all driven
// by tracking the page's scroll position:
//   1. "Compact" — shrinks its own padding/logo size once you've scrolled
//      down even a little (COMPACT_THRESHOLD), so it takes up less space
//      while browsing.
//   2. "Hide on scroll down, show on scroll up" — a common pattern where the
//      whole bar slides up out of view while you're scrolling DOWN through
//      content (giving more screen space), then slides back in the instant
//      you scroll back UP (so it's there when you want to navigate).
//   3. A mobile hamburger menu (open/close a full-width nav panel).
//
// Styling lives in src/styles/shared.module.css.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/button";
import { MenuIcon, ShoppingCartIcon, XMarkIcon } from "@/components/icons";
import { useCart } from "@/lib/cart";
import { siteConfig } from "@/lib/brand";
import styles from "@/styles/shared.module.css";

// Named constants instead of "magic numbers" scattered through the logic
// below — makes it obvious what each number means and gives one place to
// tune the feel of the scroll behavior.
const COMPACT_THRESHOLD = 24; // px scrolled before switching to the smaller/compact header
const HIDE_THRESHOLD = 140; // px scrolled before the header is even ALLOWED to hide (stays visible near the very top of the page)
const SCROLL_DELTA = 4; // minimum px of scroll movement before reacting — filters out tiny, jittery scroll events

export function Header() {
  const [open, setOpen] = useState(false); // is the mobile hamburger menu open?
  const [compact, setCompact] = useState(false); // has the user scrolled past COMPACT_THRESHOLD?
  const [hidden, setHidden] = useState(false); // should the header be slid up out of view right now?

  // How many products are sitting in the cart, for the badge on the cart
  // icon below. `hydrated` guards against rendering a count before the cart
  // has been read out of localStorage (see lib/cart.tsx) — without it, the
  // badge would briefly render server-side-empty and then pop in.
  const { totalItems, hydrated } = useCart();

  // Why a ref AND state for the same thing (`open`)? The scroll event
  // listener below is set up ONCE (empty dependency array) and keeps
  // running for the component's whole lifetime. If it read `open` directly
  // from the state variable, it would be reading a "stale" (outdated) copy
  // captured back when the listener was first created — because JavaScript
  // closures capture whatever a variable's value was AT THE TIME the
  // function was defined, not whatever it becomes later. A ref's `.current`
  // property, by contrast, is always read fresh at the moment you access
  // it, so it's a common React pattern for letting a long-lived
  // effect/listener see up-to-date values without needing to be re-created
  // every time those values change.
  const openRef = useRef(open);

  // Keep `openRef.current` in sync with the real `open` state, every time
  // `open` changes.
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    // Track the previous scroll position across calls to `onScroll`, so
    // each new scroll event can be compared against the last one to figure
    // out which DIRECTION the user just scrolled.
    let lastY = window.scrollY;

    function onScroll() {
      const y = window.scrollY;
      setCompact(y > COMPACT_THRESHOLD);

      // Never hide the header while the mobile menu is open (checked via
      // the ref, for the "stale closure" reason explained above).
      if (!openRef.current) {
        if (y > lastY + SCROLL_DELTA && y > HIDE_THRESHOLD) {
          // Scrolled DOWN by more than SCROLL_DELTA, and we're far enough
          // from the top — hide the header.
          setHidden(true);
        } else if (y < lastY - SCROLL_DELTA) {
          // Scrolled UP by more than SCROLL_DELTA — show it again,
          // regardless of how far down the page we are.
          setHidden(false);
        }
        // If neither condition is met (very small scroll movement), do
        // nothing — leave `hidden` exactly as it was.
      }
      lastY = y;
    }

    onScroll(); // run once immediately, in case the page loads already scrolled down (e.g. from a back-navigation)
    // `{ passive: true }` tells the browser this listener will never call
    // `event.preventDefault()`, which lets it optimize scroll performance
    // instead of waiting to see if the listener blocks the scroll.
    window.addEventListener("scroll", onScroll, { passive: true });
    // Cleanup: remove the listener if this component ever unmounts, so it
    // doesn't keep running (and leaking memory) forever.
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Never actually hide the bar while the mobile menu is open, even if a
  // scroll event set `hidden` moments before it opened. This is a second,
  // simpler safety net on top of the `openRef` check above — it protects
  // against the split-second where `hidden` was already `true` right as
  // the menu opens.
  const effectivelyHidden = hidden && !open;

  return (
    <header
      // The translate classes are what actually slide the header off-screen:
      // `.headerHidden` moves it up by exactly its own height (out of view);
      // `.headerVisible` is its normal resting position. Because both are
      // paired with `transition: transform` on `.header`, switching between
      // them animates smoothly instead of jumping.
      className={`${styles.header} ${effectivelyHidden ? styles.headerHidden : styles.headerVisible}`}
    >
      <div
        // The padding shrinks (`.headerInnerCompact` vs `.headerInnerNormal`)
        // when `compact` is true, which is what makes the whole bar visually
        // smaller once you've scrolled — `.headerInner`'s `transition:
        // padding` animates that change smoothly.
        className={`${styles.headerInner} ${compact ? styles.headerInnerCompact : styles.headerInnerNormal}`}
      >
        <Link
          href="/"
          className={styles.logoLink}
          onClick={() => setOpen(false)} // close the mobile menu if it happened to be open when the logo is clicked
        >
          {/* Passing `compact` straight through to <Logo> lets IT decide
              how to shrink its own icon/text size — see logo.tsx. */}
          <Logo compact={compact} />
        </Link>

        {/* Desktop navigation — hidden below the `lg` breakpoint, where the
            hamburger menu (further down) takes over instead. */}
        <nav className={styles.desktopNav} aria-label="Primary">
          {siteConfig.navLinks.map((link) => (
            <Link key={link.label} href={link.href} className={styles.navLink}>
              {link.label}
              {/* The little red underline that sweeps in on hover — see the
                  `.navLink:hover .navLinkUnderline` rule in
                  shared.module.css, the CSS Module equivalent of Tailwind's
                  "group" pattern used elsewhere in the app. */}
              <span className={styles.navLinkUnderline} />
            </Link>
          ))}
        </nav>

        {/* Everything on the right-hand end of the bar, grouped so the cart
            icon sits next to the CTA on desktop and next to the hamburger
            on mobile (where the CTA itself is hidden). */}
        <div className={styles.headerActions}>
          {/* The cart is reachable from EVERY page, not just /products —
              a visitor who collected products and then browsed on to the
              blog still needs a way back to send their inquiry. */}
          <Link
            href="/cart"
            onClick={() => setOpen(false)}
            className={styles.cartLink}
            aria-label={hydrated && totalItems > 0 ? `Cart, ${totalItems} items` : "Cart"}
          >
            <ShoppingCartIcon className="h-5 w-5" />
            {hydrated && totalItems > 0 && <span className={styles.cartBadge}>{totalItems}</span>}
          </Link>

          <div className={styles.desktopCta}>
            <Button href="/#connect" variant="primary">
              Get Started
            </Button>
          </div>

          {/* Hamburger / close toggle button — only visible below `lg`. */}
          <button
            type="button"
            className={styles.mobileMenuButton}
            aria-label={open ? "Close menu" : "Open menu"} // announced by screen readers instead of relying on the icon alone
            aria-expanded={open} // tells assistive tech whether the menu this button controls is currently open
            aria-controls="mobile-nav" // links this button to the panel it opens/closes, by id
            onClick={() => setOpen((v) => !v)} // flip `open` to its opposite value
          >
            {open ? <XMarkIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* The mobile menu panel itself. `{open && (...)}` is a common React
          pattern: if `open` is false, the whole expression evaluates to
          `false`, and React renders nothing at all for it — the panel
          isn't just hidden with CSS, it doesn't exist in the DOM until
          `open` becomes true. */}
      {open && (
        <nav
          id="mobile-nav" // matches the aria-controls value above
          aria-label="Primary"
          className={styles.mobileNav}
        >
          <ul className={styles.mobileNavList}>
            {siteConfig.navLinks.map((link) => (
              <li key={link.label} className={styles.mobileNavItem}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)} // close the menu once a link is actually clicked
                  className={styles.mobileNavLink}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Button href="/#connect" variant="primary" className={styles.mobileCta} onClick={() => setOpen(false)}>
            Get Started
          </Button>
        </nav>
      )}
    </header>
  );
}
