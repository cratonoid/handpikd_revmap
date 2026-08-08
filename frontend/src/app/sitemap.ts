// ---------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------
// Next.js App Router convention: exporting a default function from
// `app/sitemap.ts` makes Next.js generate `/sitemap.xml` at build time,
// listing every public URL so search engines can discover them without
// having to crawl link-by-link. Linked from src/app/robots.ts's `sitemap`
// field. See
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
import type { MetadataRoute } from "next";
import { blogPosts } from "@/lib/blogs-data";

const baseUrl = "https://handpikd.co";

// Every static, public marketing page. Admin/customer/login are excluded —
// same reasoning as the `disallow` list in src/app/robots.ts.
const staticRoutes: MetadataRoute.Sitemap = [
  { url: baseUrl, changeFrequency: "weekly", priority: 1 },
  { url: `${baseUrl}/products`, changeFrequency: "weekly", priority: 0.9 },
  { url: `${baseUrl}/catalogue`, changeFrequency: "weekly", priority: 0.8 },
  { url: `${baseUrl}/brand-catalogues`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${baseUrl}/blogs`, changeFrequency: "weekly", priority: 0.7 },
  { url: `${baseUrl}/hamper-inquiry-form`, changeFrequency: "monthly", priority: 0.6 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  // One entry per article, reusing the same slug data that
  // generateStaticParams() in blogs/[slug]/page.tsx pre-renders from, so the
  // sitemap can never list a slug that doesn't actually exist as a page.
  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blogs/${post.slug}`,
    lastModified: post.isoDate,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...blogRoutes];
}
