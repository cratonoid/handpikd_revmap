// Next.js build/runtime configuration for the frontend app.
import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output lets the Docker image ship just the traced server
  // bundle instead of the full node_modules tree — see frontend/Dockerfile.
  output: "standalone",
  turbopack: {
    root: path.join(__dirname),
  },
  // /brand-catalogues was a separate page until its catalogues and the old
  // static /catalogue gallery were merged onto /catalogue. Permanent (308)
  // rather than temporary, so search engines transfer the old URL's ranking
  // instead of keeping both, and any existing inbound link still lands.
  // The admin app's service worker (public/sw.js). Never HTTP-cached, so a
  // changed worker reaches installed phones on their next launch instead of
  // whenever a cached copy happens to expire.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
  // Uploaded media lives on the backend. Browsers never reach this rewrite
  // in production (nginx sends /media/ straight to the backend), but the
  // image optimizer fetches "/media/..." sources from this server itself, so
  // they need to be proxied on. Baked in at build time: the Dockerfile sets
  // MEDIA_PROXY_ORIGIN to the backend's compose hostname; dev falls back to
  // the local backend.
  async rewrites() {
    return [
      {
        source: "/media/:path*",
        destination: `${process.env.MEDIA_PROXY_ORIGIN ?? "http://localhost:8000"}/media/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/brand-catalogues",
        destination: "/catalogue",
        permanent: true,
      },
    ];
  },
  images: {
    // Placeholder CDN source for section imagery until real asset hosting is chosen.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
    ],
    // Meant to keep PNGs as PNG (the WebP encoder dropped the alpha channel
    // on some transparent client logos), but in Next 16 an empty list
    // doesn't do that: the optimizer serves whatever the browser lists
    // first in its Accept header, which for every current browser is AVIF.
    // Checked on handpikd.co 2026-10-21: logos come back as image/avif with
    // transparency intact. Left as is until that's deliberately revisited.
    formats: [],
    // How long an optimized image is reused before it's re-encoded (and the
    // browser's max-age). The default 4 hours meant re-encoding the same
    // images, AVIF being slow to encode, several times a day on a small
    // server. A replaced file under /public keeps its old optimized copy for
    // up to this long, so give a changed image a new filename.
    minimumCacheTTL: 30 * 24 * 60 * 60,
  },
};

export default nextConfig;
