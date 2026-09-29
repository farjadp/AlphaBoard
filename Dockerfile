# syntax=docker/dockerfile:1.7
# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build -- --no-lint 2>/dev/null || npm run build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl \
 && addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Standalone server + static assets
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# Prisma CLI + engines for `migrate deploy` and the seed at boot
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=app:app /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
# The seed (prisma/seed.mjs) hashes the admin password; Next bundles bcryptjs into its own chunks,
# so the standalone output has no node_modules/bcryptjs of its own.
COPY --from=builder --chown=app:app /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --chown=app:app docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
