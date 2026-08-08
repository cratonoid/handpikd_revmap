// ---------------------------------------------------------------------------
// Placeholder "client logo" tiles
// ---------------------------------------------------------------------------
// Used by the scrolling client marquee (src/components/home_page/client-
// marquee.tsx) to represent the companies Handpikd has worked with. There are
// no real client logo files yet, so each company renders as a plain wordmark
// tile — a bordered card shaped exactly like a logo image slot would be —
// instead of a hand-drawn icon. This makes swapping in a real logo trivial
// later: replace the text inside <CompanyLogo> with an <Image src="..." />
// once a logo file exists for that client, without touching the marquee or
// its layout at all.
import styles from "@/styles/shared.module.css";

/** Placeholder logo tile — swap for a real <Image> once a client's logo file is available. */
export function CompanyLogo({
  name, // the company's name, rendered as the tile's wordmark
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span className={`${styles.companyLogoTile} ${className}`}>
      {name}
    </span>
  );
}
