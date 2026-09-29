#!/bin/sh
set -eu
echo "[entrypoint] applying migrations"
node node_modules/prisma/build/index.js migrate deploy
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "[entrypoint] ensuring admin exists"
  # Run the seed directly with node: `prisma db seed` would look for tsx, which the image does not ship.
  node prisma/seed.mjs || echo "[entrypoint] seed failed (non-fatal) — check the log line above"
fi
exec "$@"
