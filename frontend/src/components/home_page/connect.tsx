// ---------------------------------------------------------------------------
// <Connect> — closing CTA section (id="connect"), the last thing before the
// footer
// ---------------------------------------------------------------------------
// A plain Server Component: contact info + a short blurb on the left, the
// actual interactive contact FORM (a separate Client Component) on the
// right. Splitting it this way keeps this file simple/static while
// isolating all the form's state/validation logic in its own file.
import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/eyebrow";
import { ContactForm } from "@/components/home_page/contact-form";
import { MailIcon, PhoneIcon, MapPinIcon } from "@/components/icons";
import { siteConfig } from "@/lib/brand";
import styles from "@/styles/home-page.module.css";

export function Connect() {
  return (
    // `id="connect"` is the anchor target for every "Get Started" /
    // "Contact" button and nav link across the site ("/#connect").
    <section id="connect" className={styles.connectSection}>
      <div className={styles.connectInner}>
        <Reveal>
          <Eyebrow>Connect With Us</Eyebrow>
          <h2 className={styles.connectHeading}>Let&apos;s build your gifting program.</h2>
          <p className={styles.connectParagraph}>
            Tell us about your team and what you&apos;re trying to gift for —
            client onboarding, employee milestones, an upcoming event. We&apos;ll
            follow up with a program tailored to it.
          </p>

          <ul className={styles.connectList}>
            <li className={styles.connectListItem}>
              <MailIcon className={styles.connectIcon} />
              <a href={`mailto:${siteConfig.contact.email}`} className={styles.connectLink}>
                {siteConfig.contact.email}
              </a>
            </li>
            <li className={styles.connectListItem}>
              <PhoneIcon className={styles.connectIcon} />
              <a
                href={`tel:${siteConfig.contact.phone.replace(/[^0-9+]/g, "")}`}
                className={styles.connectLink}
              >
                {siteConfig.contact.phone}
              </a>
            </li>
            <li className={styles.connectListItem}>
              <MapPinIcon className={styles.connectIcon} />
              <span className={styles.connectText}>{siteConfig.contact.address}</span>
            </li>
          </ul>
        </Reveal>

        {/* `delayMs={120}` makes the form fade in slightly after the text
            column on the left, instead of both appearing simultaneously. */}
        <Reveal delayMs={120}>
          <ContactForm />
        </Reveal>
      </div>
    </section>
  );
}
