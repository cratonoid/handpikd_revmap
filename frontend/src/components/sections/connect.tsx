// ---------------------------------------------------------------------------
// <Connect> — closing CTA section (id="connect"), the last thing before the
// footer
// ---------------------------------------------------------------------------
// A plain Server Component: contact info + a short blurb on the left, the
// actual interactive contact FORM (a separate Client Component) on the
// right. Splitting it this way keeps this file simple/static while
// isolating all the form's state/validation logic in its own file.
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";
import { ContactForm } from "@/components/sections/contact-form";
import { MailIcon, PhoneIcon, MapPinIcon } from "@/components/icons";
import { siteConfig } from "@/lib/brand";

export function Connect() {
  return (
    // `id="connect"` is the anchor target for every "Get Started" /
    // "Contact" button and nav link across the site ("/#connect").
    <section id="connect" className="flex flex-col bg-cream-deep lg:min-h-screen lg:justify-center">
      <div className="mx-auto grid max-w-6xl gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <Eyebrow>Connect With Us</Eyebrow>
          <SplitReveal
            as="h2"
            text="Let's build your gifting program."
            className="mt-4 font-display text-3xl font-semibold text-charcoal sm:text-4xl"
          />
          <p className="mt-5 max-w-md leading-relaxed text-ink">
            Tell us about your team and what you&apos;re trying to gift for —
            client onboarding, employee milestones, an upcoming event. We&apos;ll
            follow up with a program tailored to it.
          </p>

          <ul className="mt-9 flex flex-col gap-4">
            <li className="flex items-start gap-3">
              <MailIcon className="mt-0.5 h-5 w-5 shrink-0 text-charcoal" />
              <a href={`mailto:${siteConfig.contact.email}`} className="text-ink hover:text-charcoal">
                {siteConfig.contact.email}
              </a>
            </li>
            <li className="flex items-start gap-3">
              <PhoneIcon className="mt-0.5 h-5 w-5 shrink-0 text-charcoal" />
              <a
                href={`tel:${siteConfig.contact.phone.replace(/[^0-9+]/g, "")}`}
                className="text-ink hover:text-charcoal"
              >
                {siteConfig.contact.phone}
              </a>
            </li>
            <li className="flex items-start gap-3">
              <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0 text-charcoal" />
              <span className="text-ink">{siteConfig.contact.address}</span>
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
