// ---------------------------------------------------------------------------
// <SaleBanner> — TEMPORARY full-width sale banner shown above the hero
// ---------------------------------------------------------------------------
// See sale-strip.tsx for how to remove all of the sale changes.
//
// Two separately-designed images: a wide 5:2 one for tablets/desktops and a
// tall portrait one for phones. `getImageProps` + <picture> is Next's
// "art direction" pattern — the browser picks the source whose `media`
// query matches, and both still go through next/image's optimization.
//
// The CTAs sit in their own row underneath rather than on top of the image,
// so they never cover any of the banner's artwork or text at any width.
import Link from "next/link";
import { getImageProps } from "next/image";
import { Button } from "@/components/button";
import styles from "@/styles/sale.module.css";

const alt =
  "Handpikd sale is live: up to 20% off on all products, 1 to 5 October. Corporate gifting, apparel, customised products, trophies and rigid boxes.";

export function SaleBanner() {
  const common = { alt, sizes: "100vw", priority: true };
  const {
    props: { srcSet: desktop },
  } = getImageProps({
    ...common,
    src: "/sale/sale-banner-desktop.jpg",
    width: 2560,
    height: 1024,
  });
  const {
    props: { srcSet: mobile, ...rest },
  } = getImageProps({
    ...common,
    src: "/sale/sale-banner-mobile.jpg",
    width: 1536,
    height: 2725,
  });

  return (
    <section className={styles.bannerSection}>
      <Link href="/catalogue" className={styles.bannerLink}>
        <picture>
          <source media="(min-width: 768px)" srcSet={desktop} />
          <source srcSet={mobile} />
          {/* eslint-disable-next-line jsx-a11y/alt-text -- alt is in `rest` */}
          <img {...rest} className={styles.bannerImage} />
        </picture>
      </Link>

      <div className={styles.bannerCtaRow}>
        <Button href="#connect" variant="primary" showArrow>
          Plan My Gifting
        </Button>
        <Button href="/catalogue" variant="tertiary">
          Catalogue
        </Button>
      </div>
    </section>
  );
}
