// ---------------------------------------------------------------------------
// <ClientMarquee> — the endlessly-scrolling row of client logos
// ---------------------------------------------------------------------------
// A plain Server Component — the actual scrolling animation is pure CSS
// (see the `.marquee-track` / `@keyframes marquee` rules in globals.css),
// so no client-side JavaScript is needed here at all.
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";
import { CompanyLogo } from "@/components/company-logos";

// Placeholder client roster — swap for real logo files when available.
// `Parameters<typeof CompanyLogo>[0]["icon"]` is a slightly advanced
// TypeScript trick: rather than retyping the exact list of valid icon names
// here, it reaches into the <CompanyLogo> component's own prop types
// (Parameters<...>[0] = "the type of its first argument", i.e. its props
// object, then `["icon"]` = "just the `icon` field of that"). This means if
// company-logos.tsx ever adds/renames an icon, this array's type-checking
// updates automatically without needing to be kept in sync by hand.
const clients: { name: string; icon: Parameters<typeof CompanyLogo>[0]["icon"] }[] = [
  { name: "Northwind Corp", icon: "compass" },
  { name: "Anchor & Co.", icon: "anchor" },
  { name: "Vertex Industries", icon: "peak" },
  { name: "Solace Group", icon: "sun" },
  { name: "Marigold Partners", icon: "bloom" },
  { name: "Halcyon Labs", icon: "wave" },
  { name: "Continental Traders", icon: "globe" },
  { name: "Everline Co.", icon: "infinity" },
];

// Renders one full pass of all 8 logos. Used TWICE in <ClientMarquee> below
// (see the big comment there for why) — `ariaHidden` lets the second,
// duplicate copy be hidden from screen readers so they don't announce the
// same 8 company names twice.
function ClientRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center gap-14" aria-hidden={ariaHidden || undefined}>
      {clients.map((client, i) => (
        <li key={`${client.name}-${i}`} className="flex shrink-0 items-center justify-center">
          <CompanyLogo name={client.name} icon={client.icon} className="h-9 w-9" />
        </li>
      ))}
    </ul>
  );
}

export function ClientMarquee() {
  return (
    <section className="flex flex-col justify-center border-y border-border bg-cream py-16 lg:min-h-screen">
      <Reveal className="mx-auto max-w-6xl px-5 text-center sm:px-8">
        <Eyebrow>Who We&apos;ve Worked With</Eyebrow>
        <SplitReveal
          as="h2"
          text="Brands that trust Handpikd with their gifting"
          className="mt-3 font-display text-3xl font-semibold text-charcoal sm:text-4xl"
        />
      </Reveal>

      {/* `overflow-hidden` clips anything outside this box, so the wide
          scrolling strip inside doesn't cause the whole page to scroll
          sideways. The inline `style` applies a CSS "mask" — a gradient
          that fades from transparent -> fully opaque -> transparent again
          across the width of the element. Wherever the mask is
          transparent, the content underneath it is hidden; wherever it's
          opaque, the content shows normally. The net effect is that logos
          fade out smoothly right as they reach the left/right edges,
          instead of being harshly clipped mid-logo. `WebkitMaskImage` is
          the Safari/older-Chrome-specific version of the same property —
          both are set for broad browser support. Tailwind doesn't have a
          utility class for CSS masks, so this is one of the few places in
          the app using an inline `style` object instead of className. */}
      <div
        className="marquee-group group relative mt-12 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        }}
      >
        {/* The strip contains the logo row TWICE back to back. Combined
            with the `marquee` CSS animation (globals.css) that slides this
            whole container left by exactly 50% of its own width, the
            second copy lands exactly where the first one started right as
            the loop repeats — creating the illusion of an infinitely
            repeating strip instead of a strip that visibly "resets". */}
        <div className="marquee-track flex w-max items-center gap-14">
          <ClientRow />
          <ClientRow ariaHidden />
        </div>
      </div>
    </section>
  );
}
