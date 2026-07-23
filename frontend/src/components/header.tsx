"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/button";
import { MenuIcon, XMarkIcon } from "@/components/icons";
import { siteConfig } from "@/lib/brand";

const SCROLL_THRESHOLD = 24;

export function Header() {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    function onScroll() {
      setCompact(window.scrollY > SCROLL_THRESHOLD);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b border-border/80 bg-cream/90 backdrop-blur-sm transition-[padding] duration-300 ease-out ${
        compact ? "py-1.5" : "py-3"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-button-primary"
          onClick={() => setOpen(false)}
        >
          <Logo compact={compact} />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
          {siteConfig.navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="group relative py-1 text-sm font-medium text-ink transition-colors hover:text-charcoal"
            >
              {link.label}
              <span className="absolute inset-x-0 -bottom-0.5 h-px scale-x-0 bg-red transition-transform duration-200 ease-out group-hover:scale-x-100" />
            </Link>
          ))}
        </nav>

        <div className="hidden lg:block">
          <Button href="/#connect" variant="primary">
            Get Started
          </Button>
        </div>

        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full text-charcoal lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <XMarkIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-t border-border bg-cream px-5 pb-6 pt-2 lg:hidden"
        >
          <ul className="flex flex-col">
            {siteConfig.navLinks.map((link) => (
              <li key={link.label} className="border-b border-border/70 last:border-none">
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center text-base font-medium text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Button href="/#connect" variant="primary" className="mt-5 w-full" onClick={() => setOpen(false)}>
            Get Started
          </Button>
        </nav>
      )}
    </header>
  );
}
