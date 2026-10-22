#!/bin/sh
# Vercel build: apply migrations on production deploys only (previews must not touch the prod schema),
# over the direct (unpooled) Neon URL because migrate needs a session-level advisory lock.
set -eu
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "[vercel-build] applying migrations"
  DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" npx prisma migrate deploy
fi
npm run build
