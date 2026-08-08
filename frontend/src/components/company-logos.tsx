// ---------------------------------------------------------------------------
// <CompanyLogo> — one tile in the scrolling client marquee
// ---------------------------------------------------------------------------
// Renders a client's actual logo image (from public/client-logos/) inside
// the fixed-size (but background-less/borderless) slot defined by
// `.companyLogoTile` in shared.module.css. `fill` + `object-fit: contain`
// (see `.companyLogoImage`) lets each logo — whatever its own aspect ratio —
// scale to fit the slot without being stretched or cropped.
import Image from "next/image";
import styles from "@/styles/shared.module.css";

export function CompanyLogo({
  name, // the company's name, used as the image's accessible alt text
  src, // path to the logo file under public/
  className = "",
}: {
  name: string;
  src: string;
  className?: string;
}) {
  return (
    <span className={`${styles.companyLogoTile} ${className}`}>
      <Image
        src={src}
        alt={name}
        fill
        sizes="192px"
        className={styles.companyLogoImage}
      />
    </span>
  );
}
