import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";
import { ContactForm } from "@/components/sections/contact-form";
import { MailIcon, PhoneIcon, MapPinIcon } from "@/components/icons";
import { siteConfig } from "@/lib/brand";

export function Connect() {
  return (
    <section id="connect" className="bg-cream-deep">
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

        <Reveal delayMs={120}>
          <ContactForm />
        </Reveal>
      </div>
    </section>
  );
}
