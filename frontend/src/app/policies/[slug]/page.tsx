// Route: "/policies/[slug]" — one dynamic route serving every policy page
// (order, delivery & returns, samples, privacy). Content lives in
// src/lib/policies-data.ts; same static-generation pattern as
// src/app/blogs/[slug]/page.tsx.
//
// Server Component: static content, no client-side JavaScript.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Eyebrow } from "@/components/eyebrow";
import { getPolicy, policies, type PolicyBlock } from "@/lib/policies-data";
import sharedStyles from "@/styles/shared.module.css";
import styles from "@/styles/policies.module.css";

type PageProps = {
  params: Promise<{ slug: string }>;
};

// Pre-render every policy at build time; any other slug is a 404.
export function generateStaticParams() {
  return policies.map((p) => ({ slug: p.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) notFound();

  return {
    title: policy.title,
    description: policy.description,
    alternates: { canonical: `/policies/${policy.slug}` },
  };
}

function Block({ block }: { block: PolicyBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className={styles.paragraph}>{block.text}</p>;
    case "bullets":
      return (
        <ul className={styles.bulletList}>
          {block.items.map((item) => (
            <li key={item} className={styles.bulletItem}>
              {item}
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className={styles.stepList}>
          {block.items.map((item) => (
            <li key={item} className={styles.stepItem}>
              {item}
            </li>
          ))}
        </ol>
      );
    case "example":
      return (
        <p className={styles.callout}>
          <strong className={styles.calloutLabel}>Example: </strong>
          {block.text}
        </p>
      );
    case "note":
      return (
        <p className={styles.callout}>
          <strong className={styles.calloutLabel}>Please note: </strong>
          {block.text}
        </p>
      );
  }
}

export default async function PolicyPage({ params }: PageProps) {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) notFound();

  const otherPolicies = policies.filter((p) => p.slug !== policy.slug);

  return (
    <>
      <Header />
      <main className={sharedStyles.pageMain}>
        <div className={styles.hero}>
          <Eyebrow>Handpikd Policies</Eyebrow>
          <h1 className={styles.title}>{policy.title}</h1>
          {policy.effectiveDate && (
            <p className={styles.effectiveDate}>Effective date: {policy.effectiveDate}</p>
          )}
        </div>

        <article className={styles.body}>
          <p className={styles.intro}>{policy.intro}</p>

          {policy.sections.map((section) => (
            <section key={section.heading} className={styles.section}>
              <h2 className={styles.sectionHeading}>{section.heading}</h2>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </section>
          ))}

          <nav aria-label="Other policies" className={styles.otherPolicies}>
            <h2 className={styles.otherPoliciesHeading}>Other policies</h2>
            <ul className={styles.otherPoliciesList}>
              {otherPolicies.map((p) => (
                <li key={p.slug}>
                  <Link href={`/policies/${p.slug}`} className={styles.otherPoliciesLink}>
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </article>
      </main>
      <Footer />
    </>
  );
}
