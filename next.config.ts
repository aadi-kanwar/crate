import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dine's screens show live, per-person data from Convex, so we don't use
  // Next.js's server data caching (cacheComponents / partialPrefetching).
  experimental: {
    // The pages themselves hold no data (it comes live from Convex in the
    // browser), so the browser may keep and reuse them. Without this, every
    // tab tap asked the web server for the page again: a noticeable wait.
    staleTimes: { dynamic: 300, static: 300 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
