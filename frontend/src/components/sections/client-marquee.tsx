import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";

// Placeholder client roster — swap for real logo assets when available.
const clients = [
  "Northwind Corp",
  "Anchor & Co.",
  "Vertex Industries",
  "Solace Group",
  "Marigold Partners",
  "Halcyon Labs",
  "Continental Traders",
  "Everline Co.",
];

function ClientRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <ul
      className="flex shrink-0 items-center gap-4"
      aria-hidden={ariaHidden || undefined}
    >
      {clients.map((name, i) => (
        <li
          key={`${name}-${i}`}
          className="flex h-16 items-center rounded-xl border border-border bg-white px-7 whitespace-nowrap"
        >
          <span className="font-display text-base font-semibold tracking-wide text-charcoal/70">
            {name}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ClientMarquee() {
  return (
    <section className="border-y border-border bg-cream py-16">
      <Reveal className="mx-auto max-w-6xl px-5 text-center sm:px-8">
        <Eyebrow>Who We&apos;ve Worked With</Eyebrow>
        <SplitReveal
          as="h2"
          text="Brands that trust Handpikd with their gifting"
          className="mt-3 font-display text-3xl font-semibold text-charcoal sm:text-4xl"
        />
      </Reveal>

      <div
        className="marquee-group group relative mt-10 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        }}
      >
        <div className="marquee-track flex w-max gap-4">
          <ClientRow />
          <ClientRow ariaHidden />
        </div>
      </div>
    </section>
  );
}
