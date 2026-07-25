// Route: "/blogs/[slug]" — one dynamic route serving all 21 blog articles.
//
// The `[slug]` folder name is Next.js App Router syntax for a dynamic route
// segment: visiting "/blogs/diwali-corporate-gift-ideas" renders THIS file
// with `params.slug === "diwali-corporate-gift-ideas"`. Rather than hand-
// writing 21 near-identical page.tsx files, this one template renders every
// post by looking it up in src/lib/blogs-data.ts.
//
// Server Component throughout — nothing here needs interactivity, so the
// whole article ships as plain HTML with no client-side JavaScript.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/button";
import { getAllSlugs, getBlogPost, getRelatedPosts } from "@/lib/blogs-data";
import sharedStyles from "@/styles/shared.module.css";
import styles from "@/styles/blogs.module.css";

// Every page/layout in the App Router receives `params` as a Promise (as of
// Next.js 15+) rather than a plain object — awaiting it below is required,
// not optional, even though there's only one dynamic segment.
type PageProps = {
  params: Promise<{ slug: string }>;
};

// Tells Next.js exactly which `slug` values exist at BUILD time, so it can
// pre-render all 21 articles to static HTML instead of generating them on
// demand for every visitor. Returning `{ slug }` for each of getAllSlugs()'s
// entries is what makes `/blogs/<any-real-slug>` a fully static page.
export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

// Per-post <title>/<meta description> tags. Because layout.tsx's
// `metadata.title.template` is `"%s | Handpikd"`, `post.title` alone (no
// manual "| Handpikd" suffix) is correct here — same convention as
// src/app/products/page.tsx.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  // `notFound()` throws internally to tell Next.js "render the 404 page
  // instead" — it never actually returns, but TypeScript doesn't know that,
  // so the `if` block still needs its own return-less shape below.
  if (!post) notFound();

  return {
    title: post.title,
    description: post.description,
  };
}

// Renders a trusted HTML string (a paragraph or list item from
// blogs-data.ts) via `dangerouslySetInnerHTML`. This is safe for the exact
// same reason the JSON-LD script in src/app/layout.tsx is safe: every
// string this function ever receives is hardcoded by a developer inside
// blogs-data.ts, never typed in by a site visitor — there is no path from
// user input to this component. See blogs-data.ts's top-of-file comment
// for the same trust model spelled out from the data side.
function RichText({
  html,
  as: Tag = "p",
  className,
}: {
  html: string;
  as?: "p" | "li";
  className?: string;
}) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const relatedPosts = getRelatedPosts(post);

  return (
    <>
      <Header />
      <main className={sharedStyles.pageMain}>
        {/* Breadcrumb: Home -> Blogs -> current article. The final crumb is
            plain text (not a link) since it represents the page you're
            already on. */}
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/" className={styles.breadcrumbLink}>
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link href="/blogs" className={styles.breadcrumbLink}>
            Blogs
          </Link>
          <span aria-hidden="true">/</span>
          <span className={styles.breadcrumbCurrent}>{post.title}</span>
        </nav>

        <header className={styles.articleHero}>
          <span className={styles.postChip}>{post.categoryLabel}</span>
          <h1 className={styles.articleTitle}>{post.title}</h1>
          <div className={styles.articleMetaRow}>
            <span>{post.date}</span>
            <span className={styles.articleMetaDot} aria-hidden="true" />
            <span>{post.readTime}</span>
          </div>
        </header>

        <article className={styles.articleBody}>
          <RichText html={post.intro} className={styles.articleIntro} />

          {post.sections.map((section, i) => (
            // Sections have no stable unique id of their own (headings can
            // repeat conceptually across posts, e.g. every post has its own
            // "Conclusion"), so the array index is fine here — this list is
            // static per-post and never reorders at runtime.
            <div key={i} className={styles.articleSection}>
              {section.heading &&
                (section.level === 3 ? (
                  <h3 className={styles.articleHeadingLevel3}>{section.heading}</h3>
                ) : (
                  <h2 className={styles.articleHeadingLevel2}>{section.heading}</h2>
                ))}

              {section.paragraphs?.map((paragraph, j) => (
                <RichText key={j} html={paragraph} className={styles.articleParagraph} />
              ))}

              {section.list && (
                <ul className={styles.articleList}>
                  {section.list.map((item, j) => (
                    <RichText key={j} as="li" html={item} className={styles.articleListItem} />
                  ))}
                </ul>
              )}

              {section.stats && (
                <div className={styles.statsGrid}>
                  {section.stats.map((stat) => (
                    <div key={stat.label} className={styles.statCell}>
                      <div className={styles.statValue}>{stat.value}</div>
                      <div className={styles.statLabel}>{stat.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </article>

        {/* Inline CTA — every article gets the SAME generic call-to-action
            here, rather than the old site's per-post promotional box (a
            "starting at ₹300/piece, MOQ 25 units" WhatsApp deep link box —
            see blogs-data.ts's extraction notes for why that specific box
            didn't carry over). One consistent block styled with this
            codebase's own <Button>/design system replaces all 21 one-off
            copies. */}
        <div className={styles.inlineCta}>
          <h2 className={styles.inlineCtaHeading}>Looking to Start a Gifting Program?</h2>
          <p className={styles.inlineCtaText}>
            Tell us about your team, clients, or next event — we&apos;ll help you put together a
            gifting plan that fits your budget.
          </p>
          <div className={styles.inlineCtaActions}>
            <Button href="/#connect" variant="primary" showArrow>
              Talk to Us
            </Button>
            <Button href="/products" variant="tertiary">
              Browse Products
            </Button>
          </div>
        </div>

        {relatedPosts.length > 0 && (
          <section className={styles.relatedSection}>
            <h2 className={styles.relatedHeading}>Related Articles</h2>
            <div className={styles.relatedGrid}>
              {relatedPosts.map((related) => (
                <Link key={related.slug} href={`/blogs/${related.slug}`} className={styles.relatedCard}>
                  <span className={styles.relatedCardChip}>{related.categoryLabel}</span>
                  <h3 className={styles.relatedCardTitle}>{related.title}</h3>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className={styles.backLinkRow}>
          <Link href="/blogs" className={styles.backLink}>
            ← Back to Blogs
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
