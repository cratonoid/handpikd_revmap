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
  },
};

export default nextConfig;
