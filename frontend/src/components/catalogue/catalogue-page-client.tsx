"use client";

// ---------------------------------------------------------------------------
// <CataloguePageClient> — the interactive body of the /catalogue page
// ---------------------------------------------------------------------------
// Renders every category from catalogue-data.ts as its own section of
// <CatalogueCard> tiles, and owns the one piece of state the whole page
// needs: which folder's gallery (if any) is currently open in the
// <GalleryLightbox> modal. Rendered by src/app/catalogue/page.tsx (a Server
// Component), which wraps this with the Header, banner, CTA, and Footer.
import { useState } from "react";
import { catalogueCategories, getGalleryImages } from "@/lib/catalogue-data";
import { CatalogueCard, catalogueIconComponents } from "@/components/catalogue/catalogue-card";
import { GalleryLightbox } from "@/components/catalogue/gallery-lightbox";
import styles from "@/styles/catalogue.module.css";

export function CataloguePageClient() {
  // Which item's gallery is open right now — `null` means the lightbox is
  // closed. Storing the whole { title, folder } pair (rather than just a
  // folder string) means the lightbox's title is available without having
  // to look it back up from catalogueCategories.
  const [active, setActive] = useState<{ title: string; folder: string } | null>(null);

  return (
    <div className={styles.pageInner}>
      {catalogueCategories.map((category) => {
        const CategoryIcon = catalogueIconComponents[category.icon];
        return (
          <section key={category.title} className={styles.categoryBlock}>
            <div className={styles.categoryHeader}>
              <span aria-hidden="true" className={styles.categoryHeaderIconWrap}>
                <CategoryIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className={styles.categoryTitle}>{category.title}</h2>
                <p className={styles.categoryDescription}>{category.description}</p>
              </div>
            </div>
            <div className={styles.categoryGrid}>
              {category.items.map((item) => (
                <CatalogueCard
                  key={item.folder}
                  title={item.title}
                  icon={item.icon}
                  onOpen={() => setActive({ title: item.title, folder: item.folder })}
                />
              ))}
            </div>
          </section>
        );
      })}

      {active && (
        <GalleryLightbox
          title={active.title}
          images={getGalleryImages(active.folder)}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
