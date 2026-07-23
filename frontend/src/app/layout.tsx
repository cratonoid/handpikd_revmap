// Root layout applied to every page: sets up fonts, global styles, and page metadata.
import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const title = "Handpikd | B2B Corporate Gifting Programs, Fully Managed";
const description =
  "Handpikd builds corporate gifting programs — client gifts, employee milestones, and event gifting — sourced and shipped nationwide.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s | Handpikd",
  },
  description,
  keywords: [
    "corporate gifting",
    "corporate gifts",
    "B2B gifting programs",
    "employee gifting",
    "client gifting",
    "event gifting",
    "branded corporate merchandise",
  ],
  openGraph: {
    title,
    description,
    siteName: "Handpikd",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Handpikd",
  description,
  email: "hello@handpikd.com",
  address: {
    "@type": "PostalAddress",
    streetAddress: "148 Ribbon Row, Suite 400",
    addressLocality: "Austin",
    addressRegion: "TX",
    postalCode: "78701",
    addressCountry: "US",
  },
  sameAs: ["https://linkedin.com", "https://instagram.com"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} h-full scroll-pt-24 motion-safe:scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream font-sans text-ink">
        {/* Guarantee reveal-on-scroll content is visible if JavaScript is unavailable. */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
