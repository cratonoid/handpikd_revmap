// ---------------------------------------------------------------------------
// <Footer> — site-wide footer, rendered on every page
// ---------------------------------------------------------------------------
// A plain Server Component (no "use client", no interactivity) that lists
// the logo/blurb/social links, a copy of the main nav links, contact info,
// and a bottom copyright bar. It's deliberately dark (bg-charcoal) while
// almost every other section on the site is light — a common "anchor" the
// page ends on.
//
// Styling lives in src/styles/shared.module.css.
import Link from "next/link";
import { Logo } from "@/components/logo";
import { MailIcon, PhoneIcon, MapPinIcon, WhatsAppIcon } from "@/components/icons";
import { siteConfig } from "@/lib/brand";
import styles from "@/styles/shared.module.css";

// Reuse the same nav links defined once in brand.ts, but drop "Contact" —
// the footer already has its own dedicated "Get in touch" column below, so
// repeating a "Contact" link in the nav-links column would be redundant.
// `.filter()` returns a NEW array containing only the items where the
// callback returns true; it doesn't modify `siteConfig.navLinks` itself.
const companyLinks = siteConfig.navLinks.filter((l) => l.label !== "Contact");

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        {/* Three-column layout on desktop (logo/blurb column is wider than
            the other two — `1.4fr` vs `1fr`), stacking to one column on
            small screens because the grid-template-columns rule is only
            applied at the `md:` breakpoint and up (see shared.module.css). */}
        <div className={styles.footerGrid}>
          <div className={styles.footerBrandCol}>
            <Link href="/" className={styles.footerLogoLink}>
              {/* variant="light" makes the wordmark text cream-colored and
                  inverts the logo image to white — see logo.tsx for how
                  that works, this is a dark section. */}
              <Logo variant="light" />
            </Link>
            <p className={styles.footerBlurb}>
              Handpikd designs, sources, and delivers corporate gifting programs —
              client gifts, employee milestones, and everything in between.
            </p>
            <div className={styles.footerSocialRow}>
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
                  className={styles.footerSocialLink}
                >
                  <WhatsAppIcon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className={styles.footerColHeading}>Company</h3>
            <ul className={styles.footerLinkList}>
              {companyLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className={styles.footerLink}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={styles.footerColHeading}>Get in touch</h3>
            <ul className={styles.footerContactList}>
              <li className={styles.footerContactItem}>
                <MailIcon className={`h-4 w-4 ${styles.footerContactIcon}`} />
                {/* `mailto:` and `tel:` links (below) tell the browser to
                    open the user's default email/phone app instead of
                    navigating to a webpage. */}
                <a href={`mailto:${siteConfig.contact.email}`} className={styles.footerContactLink}>
                  {siteConfig.contact.email}
                </a>
              </li>
              <li className={styles.footerContactItem}>
                <PhoneIcon className={`h-4 w-4 ${styles.footerContactIcon}`} />
                <a
                  // `tel:` links need a clean number with no spaces,
                  // parentheses, or dashes. `.replace(/[^0-9+]/g, "")`
                  // uses a regular expression to strip out every character
                  // that ISN'T a digit or a "+" sign, turning
                  // "+91 74116 90399" into "+917411690399".
                  href={`tel:${siteConfig.contact.phone.replace(/[^0-9+]/g, "")}`}
                  className={styles.footerContactLink}
                >
                  {siteConfig.contact.phone}
                </a>
              </li>
              <li className={styles.footerContactItem}>
                <MapPinIcon className={`h-4 w-4 ${styles.footerContactIcon}`} />
                <span>{siteConfig.contact.address}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar: copyright + legal links. Stacks vertically on
            mobile, sits side-by-side on larger screens. */}
        <div className={styles.footerBottom}>
          <p>&copy; {new Date().getFullYear()} Handpikd. All rights reserved.</p>
          <div className={styles.footerLegalLinks}>
            <Link href="#" className={styles.footerLegalLink}>
              Privacy Policy
            </Link>
            <Link href="#" className={styles.footerLegalLink}>
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
