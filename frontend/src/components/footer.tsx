// ---------------------------------------------------------------------------
// <Footer> — site-wide footer, rendered on every page
// ---------------------------------------------------------------------------
// A plain Server Component (no "use client", no interactivity) that lists
// the logo/blurb/social links, a copy of the main nav links, contact info,
// and a bottom copyright bar. It's deliberately dark (bg-charcoal) while
// almost every other section on the site is light — a common "anchor" the
// page ends on.
import Link from "next/link";
import { Logo } from "@/components/logo";
import { MailIcon, PhoneIcon, MapPinIcon, LinkedInIcon, InstagramIcon } from "@/components/icons";
import { siteConfig } from "@/lib/brand";

// Reuse the same nav links defined once in brand.ts, but drop "Contact" —
// the footer already has its own dedicated "Get in touch" column below, so
// repeating a "Contact" link in the nav-links column would be redundant.
// `.filter()` returns a NEW array containing only the items where the
// callback returns true; it doesn't modify `siteConfig.navLinks` itself.
const companyLinks = siteConfig.navLinks.filter((l) => l.label !== "Contact");

export function Footer() {
  return (
    <footer className="bg-charcoal text-cream/70">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        {/* Three-column layout on desktop (logo/blurb column is wider than
            the other two — `1.4fr` vs `1fr`), stacking to one column on
            small screens because `grid-cols-[...]` is only applied at the
            `md:` breakpoint and up (see className below). */}
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="max-w-sm">
            <Link href="/" className="inline-block">
              {/* variant="light" makes the wordmark text cream-colored and
                  inverts the logo image to white — see logo.tsx for how
                  that works, this is a dark section. */}
              <Logo variant="light" />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-cream/60">
              Handpikd designs, sources, and delivers corporate gifting programs —
              client gifts, employee milestones, and everything in between.
            </p>
            <div className="mt-6 flex items-center gap-3">
              {/* One circular icon button per entry in siteConfig.social.
                  `.map()` transforms each `{ label, href }` object into a
                  JSX element; React needs a unique `key` prop whenever
                  you render a list this way. */}
              {siteConfig.social.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank" // open in a new browser tab
                  rel="noreferrer noopener" // security best practice for target="_blank" links to external sites — prevents the new tab from being able to control this page via window.opener
                  aria-label={s.label} // screen readers announce this instead of trying to read the icon
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-cream/20 text-cream transition-colors hover:border-red hover:bg-red hover:text-cream"
                >
                  {/* Ternary (condition ? A : B) picks which icon to render
                      based on the label — a simple way to vary content
                      per-item without a lookup table, since there are only
                      two possible social platforms right now. */}
                  {s.label === "LinkedIn" ? (
                    <LinkedInIcon className="h-4 w-4" />
                  ) : (
                    <InstagramIcon className="h-4 w-4" />
                  )}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold tracking-[0.14em] text-cream uppercase">
              Company
            </h3>
            <ul className="mt-5 flex flex-col gap-3">
              {companyLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-cream/60 hover:text-cream">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold tracking-[0.14em] text-cream uppercase">
              Get in touch
            </h3>
            <ul className="mt-5 flex flex-col gap-3 text-sm text-cream/60">
              <li className="flex items-start gap-2.5">
                <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-cream" />
                {/* `mailto:` and `tel:` links (below) tell the browser to
                    open the user's default email/phone app instead of
                    navigating to a webpage. */}
                <a href={`mailto:${siteConfig.contact.email}`} className="hover:text-cream">
                  {siteConfig.contact.email}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <PhoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-cream" />
                <a
                  // `tel:` links need a clean number with no spaces,
                  // parentheses, or dashes. `.replace(/[^0-9+]/g, "")`
                  // uses a regular expression to strip out every character
                  // that ISN'T a digit or a "+" sign, turning
                  // "+1 (844) 555-0142" into "+18445550142".
                  href={`tel:${siteConfig.contact.phone.replace(/[^0-9+]/g, "")}`}
                  className="hover:text-cream"
                >
                  {siteConfig.contact.phone}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-cream" />
                <span>{siteConfig.contact.address}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar: copyright + legal links. Stacks vertically on
            mobile, sits side-by-side on larger screens (`sm:flex-row`). */}
        <div className="mt-14 flex flex-col gap-4 border-t border-cream/10 pt-8 text-xs text-cream/50 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Handpikd. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="#" className="hover:text-cream">
              Privacy Policy
            </Link>
            <Link href="#" className="hover:text-cream">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
