import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Backend tests run against convex-test, an in-memory Convex backend.
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
    testTimeout: 30_000,
  },
});
