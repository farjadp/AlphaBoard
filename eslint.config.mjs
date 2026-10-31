import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// v1 switched off exhaustive-deps, set-state-in-effect and no-explicit-any to unblock a deploy.
// They are back on; the only exception is documented below.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    // Pages, routes and components reach the database only through lib/ services (DTOs, ownership checks).
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@/lib/db/client", message: "Query through a lib/ service; app/ and components/ never touch Prisma directly." }],
      }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "next-env.d.ts"]),
]);

export default eslintConfig;
