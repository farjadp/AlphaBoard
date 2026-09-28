import { execSync } from "node:child_process";

/** Applies migrations to the test database once per run (no-op when TEST_DATABASE_URL is unset). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
