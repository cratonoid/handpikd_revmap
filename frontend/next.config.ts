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
    // Empty array disables automatic AVIF/WebP re-encoding, so the optimizer
    // resizes/compresses but always outputs the source's own format (PNG
    // stays PNG). Needed because this Next version's WebP re-encode path
    // silently drops the alpha channel for some of the transparent
    // client-logo PNGs (flattens them to opaque RGB) — the PNG output path
    // doesn't have that bug. Trade-off: WebP/AVIF are usually smaller than
    // PNG at equal quality, so this costs some bytes on other optimized
    // images sitewide in exchange for correct transparency everywhere.
    formats: [],
  },
};

export default nextConfig;
