import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": here },
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
    server: { deps: { inline: [] } },
  },
});
