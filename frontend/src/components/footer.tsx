import Link from "next/link";
import { Logo } from "@/components/logo";
import { MailIcon, PhoneIcon, MapPinIcon, LinkedInIcon, InstagramIcon } from "@/components/icons";
import { siteConfig } from "@/lib/brand";

const companyLinks = siteConfig.navLinks.filter((l) => l.label !== "Contact");

export function Footer() {
  return (
    <footer className="border-t border-charcoal/10 bg-cream text-ink">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="max-w-sm">
            <Link href="/" className="inline-block">
              <Logo variant="dark" />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-ink">
              Handpikd designs, sources, and delivers corporate gifting programs —
              client gifts, employee milestones, and everything in between.
            </p>
            <div className="mt-6 flex items-center gap-3">
              {siteConfig.social.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={s.label}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-charcoal/20 text-charcoal transition-colors hover:bg-charcoal hover:text-cream"
                >
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
            <h3 className="font-display text-sm font-semibold tracking-[0.14em] text-charcoal uppercase">
              Company
            </h3>
            <ul className="mt-5 flex flex-col gap-3">
              {companyLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-ink hover:text-charcoal">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold tracking-[0.14em] text-charcoal uppercase">
              Get in touch
            </h3>
            <ul className="mt-5 flex flex-col gap-3 text-sm text-ink">
              <li className="flex items-start gap-2.5">
                <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-charcoal" />
                <a href={`mailto:${siteConfig.contact.email}`} className="hover:text-charcoal">
                  {siteConfig.contact.email}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <PhoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-charcoal" />
                <a href={`tel:${siteConfig.contact.phone.replace(/[^0-9+]/g, "")}`} className="hover:text-charcoal">
                  {siteConfig.contact.phone}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-charcoal" />
                <span>{siteConfig.contact.address}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-charcoal/10 pt-8 text-xs text-ink/70 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Handpikd. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="#" className="hover:text-charcoal">
              Privacy Policy
            </Link>
            <Link href="#" className="hover:text-charcoal">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
