"use client";

// ---------------------------------------------------------------------------
// <BrandCataloguesPageClient> — the interactive body of the /brand-catalogues
// page
// ---------------------------------------------------------------------------
// Fetches GET /catalogues/get_public_catalogues (lib/catalogues.ts's
// fetchPublicCatalogueSections), which comes back already grouped by
// catalogue_type and then by root category. This component just turns that
// into: one tab per catalogue_type ("brand" -> Brand Catalogs, "regular" ->
// Category Wise Catalogs), and within the active tab, one subheading per
// category with that category's catalogues as cards. Clicking a card opens
// the same <GalleryLightbox> the static /catalogue page uses, showing that
// catalogue's converted PDF pages.
import { useEffect, useState } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { fetchPublicCatalogueSections, type PublicCatalogueItem, type PublicCatalogueSection } from "@/lib/catalogues";
import { BrandCatalogueCard } from "@/components/brand-catalogues/brand-catalogue-card";
import { GalleryLightbox } from "@/components/catalogue/gallery-lightbox";
import styles from "@/styles/brand-catalogues.module.css";

type LoadState = "loading" | "loaded" | "error";

const SECTION_TITLES: Record<string, string> = {
  brand: "Brand Catalogs",
  regular: "Category Wise Catalogs",
};

function sectionTitle(catalogueType: string): string {
  return SECTION_TITLES[catalogueType] ?? catalogueType;
}

export function BrandCataloguesPageClient() {
  const [sections, setSections] = useState<PublicCatalogueSection[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeCatalogue, setActiveCatalogue] = useState<PublicCatalogueItem | null>(null);

  useEffect(() => {
    fetchPublicCatalogueSections()
      .then((data) => {
        setSections(data);
        setActiveType(data[0]?.catalogueType ?? null);
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }, []);

  const activeSection = sections.find((section) => section.catalogueType === activeType) ?? null;

  return (
    <div className={styles.pageInner}>
      {loadState === "loading" && <p className={styles.emptyState}>Loading catalogues…</p>}
      {loadState === "error" && <p className={styles.emptyState}>Failed to load catalogues.</p>}

      {loadState === "loaded" && sections.length === 0 && (
        <p className={styles.emptyState}>No catalogues are available yet.</p>
      )}

      {loadState === "loaded" && sections.length > 0 && (
        <>
          <div className={styles.tabBar} role="tablist" aria-label="Catalogue sections">
            {sections.map((section) => (
              <button
                key={section.catalogueType}
                type="button"
                role="tab"
                aria-selected={section.catalogueType === activeType}
                onClick={() => setActiveType(section.catalogueType)}
                className={`${styles.tabButton} ${
                  section.catalogueType === activeType ? styles.tabButtonActive : ""
                }`}
              >
                {sectionTitle(section.catalogueType)}
              </button>
            ))}
          </div>

          {activeSection?.categories.map((category) => (
            <section key={category.categoryId} className={styles.categoryBlock}>
              <h2 className={styles.categoryTitle}>{category.categoryName}</h2>
              <div className={styles.categoryGrid}>
                {category.catalogues.map((catalogue) => (
                  <BrandCatalogueCard
                    key={catalogue.id}
                    catalogueName={catalogue.catalogueName}
                    vendorName={catalogue.vendorName}
                    coverImagePath={catalogue.imagePaths[0]}
                    onOpen={() => setActiveCatalogue(catalogue)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {activeCatalogue && (
        <GalleryLightbox
          title={activeCatalogue.catalogueName}
          images={activeCatalogue.imagePaths.map(resolveMediaUrl)}
          onClose={() => setActiveCatalogue(null)}
        />
      )}
    </div>
  );
}
