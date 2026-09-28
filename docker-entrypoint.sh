#!/bin/sh
set -eu
echo "[entrypoint] applying migrations"
node node_modules/prisma/build/index.js migrate deploy
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "[entrypoint] ensuring admin exists"
  node node_modules/prisma/build/index.js db seed || echo "[entrypoint] seed skipped/failed (non-fatal)"
fi
exec "$@"
