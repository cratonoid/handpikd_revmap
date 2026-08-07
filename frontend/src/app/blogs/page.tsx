// Route: "/blogs" — the blog index.
//
// This used to render the shared <ComingSoon> placeholder (see
// src/components/coming-soon.tsx) because there was no real blog content
// yet. Now that all 21 articles live in src/lib/blogs-data.ts, this file
// replaces that placeholder with a real category-grouped index, mirroring
// the old marketing site's blogs-list.html but rebuilt with this codebase's
// own design system.
//
// Server Component (no "use client") — the whole page is static content
// derived from blogs-data.ts at build time, so there's no need to ship any
// client-side JavaScript for it.
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/button";
import { Eyebrow } from "@/components/eyebrow";
import { ArrowRightIcon } from "@/components/icons";
import { blogCategories, blogPosts } from "@/lib/blogs-data";
import sharedStyles from "@/styles/shared.module.css";
import styles from "@/styles/blogs.module.css";

export const metadata: Metadata = {
  title: "Corporate Gifting Blog",
  description:
    "Expert insights, trends, and ideas on employee gifting, client appreciation, and premium corporate gifting strategies for Indian businesses.",
};

export default function BlogsPage() {
  return (
    <>
      <Header />
      <main className={sharedStyles.pageMain}>
        <div className={styles.indexHero}>
          <Eyebrow>Handpikd Blog</Eyebrow>
          <h1 className={styles.indexHeroTitle}>Corporate Gifting Blog — Expert Insights & Ideas</h1>
          <p className={styles.indexHeroSubtitle}>
            Discover the latest trends, tips, and strategies for corporate gifting that strengthens
            business relationships — from employee recognition to client appreciation and sustainable
            sourcing.
          </p>
        </div>

        {/* One section per category, each listing its posts in the fixed
            order defined in blogCategories (src/lib/blogs-data.ts) — NOT a
            re-sort of blogPosts, so this stays in sync with the old site's
            editorial grouping rather than reflowing whenever new posts are
            appended to the data file. */}
        {blogCategories.map((category) => {
          // `postSlugs` only stores ids; look up the full post objects here
          // so the map below has titles/deks/categoryLabels to render.
          // `.filter()` after `.map()` is the same defensive pattern used by
          // getRelatedPosts() in blogs-data.ts — a typo'd slug quietly drops
          // instead of crashing the whole index page.
          const posts = category.postSlugs
            .map((slug) => blogPosts.find((post) => post.slug === slug))
            .filter((post): post is NonNullable<typeof post> => post !== undefined);

          return (
            <section key={category.name} className={styles.categorySection}>
              <div className={styles.categoryHeader}>
                <span className={styles.categoryIcon} aria-hidden="true">
                  {category.icon}
                </span>
                <div>
                  <h2 className={styles.categoryName}>{category.name}</h2>
                  <p className={styles.categoryDescription}>{category.description}</p>
                </div>
              </div>

              <div className={styles.postList}>
                {posts.map((post) => (
                  <Link key={post.slug} href={`/blogs/${post.slug}`} className={styles.postRow}>
                    <div className={styles.postRowContent}>
                      <h3 className={styles.postRowTitle}>{post.title}</h3>
                      <p className={styles.postRowDek}>{post.description}</p>
                      <div className={styles.postRowMeta}>
                        <span className={styles.postChip}>{post.categoryLabel}</span>
                      </div>
                    </div>
                    <span className={styles.postRowArrowWrap} aria-hidden="true">
                      <ArrowRightIcon className="h-4 w-4" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        <div className={styles.closingCta}>
          <h2 className={styles.closingCtaHeading}>Need Help With Your Corporate Gifting Strategy?</h2>
          <p className={styles.closingCtaText}>
            Our gifting experts help you create memorable experiences for employees and clients — from
            first idea to final delivery.
          </p>
          <div className={styles.closingCtaActions}>
            <Button href="/#connect" variant="primary" showArrow>
              Get in Touch
            </Button>
            <Button href="/products" variant="tertiary">
              Browse Products
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
