import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": here, "server-only": path.join(here, "tests/setup/serverOnly.ts") },
  },
  // Keep vite's file crawling/watching away from the (slow, cloud-synced) project root.
  cacheDir: path.join(process.env.TMPDIR ?? "/tmp", "alphaboard-vite"),
  server: { watch: null, fs: { strict: true, allow: [here] } },
  test: {
    environment: "node",
    dir: "tests",
    include: ["**/*.test.ts"],
    watch: false,
    globals: false,
    clearMocks: true,
    pool: "forks",
    setupFiles: ["tests/setup/env.ts"],
    globalSetup: ["tests/setup/globalSetup.ts"],
    // DB suites share one schema; run files sequentially so they cannot interfere.
    fileParallelism: false,
    server: { deps: { inline: [] } },
  },
});
