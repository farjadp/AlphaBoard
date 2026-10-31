#!/bin/sh
# Vercel build: apply migrations on production deploys only (previews must not touch the prod schema),
# over the direct (unpooled) Neon URL because migrate needs a session-level advisory lock.
set -eu
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "[vercel-build] applying migrations"
  DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" npx prisma migrate deploy
fi
# The restored Turbopack build cache keys modules by path; after files move it resolved next/font's
# virtual module wrongly ("Can't resolve '@vercel/turbopack-next/internal/font/google/font'", P13c).
# Start Turbopack from a clean cache; the rest of .next/cache is kept.
rm -rf .next/cache/turbopack
npm run build
