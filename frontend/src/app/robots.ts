// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------
// Next.js App Router convention: exporting a default function from
// `app/robots.ts` makes Next.js generate `/robots.txt` at build time from the
// object returned below, instead of hand-writing a static text file. See
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
//
// This tells search engine crawlers (Googlebot, etc.) which parts of the
// site are public content worth indexing and which are private
// dashboards/API routes that shouldn't show up in search results.

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Admin dashboard, customer account pages, the login form, and the
      // backend API are all logged-in/functional surfaces with nothing for
      // a search engine to index.
      disallow: ["/admin", "/customer", "/login", "/api/"],
    },
    sitemap: "https://handpikd.co/sitemap.xml",
    host: "https://handpikd.co",
  };
}
