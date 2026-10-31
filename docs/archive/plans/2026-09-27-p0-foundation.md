# P0 · Foundation — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-27-alphaboard-v2-design.md` (§2 D2–D3, D12–D14; §4 P0)
**Goal:** Every request is authenticated, rate-limited, logged, and the app runs from a reproducible container with real DB migrations.
**Branch:** `v2` · **Commits:** one per task below.

## Global constraints
- Next.js 16 App Router, TypeScript strict, Tailwind v4, Prisma 6, NextAuth 5 beta (credentials + JWT).
- Never `prisma db push` in prod. Migrations live in `prisma/migrations/`.
- No secrets in query strings, logs, or client bundles.
- Tests: Vitest (`npm test`). Pure logic gets a failing test first.

## Tasks

- [ ] **T1 Dev database + tooling** — `docker-compose.yml` (postgres:16 on 5433), `.env.example`, `DATABASE_URL` in `.env`; deps: `pino`, `vitest`, `tsx`; `vitest.config.ts`; scripts `test`, `db:migrate`, `db:seed`; `start` → `prisma migrate deploy && next start`.
- [ ] **T2 Schema v2 baseline** — `prisma/schema.prisma`: User(+role enum, disclaimerAcceptedAt, aiProvider/aiModel, dailyTokenQuota), Invite, AppSetting, AuditLog; drop unused UserChart/CourseLesson/UserProgress/TradeLog (portal skeleton). `prisma migrate dev --name v2_baseline`.
- [ ] **T3 DAL** — `lib/auth/dal.ts`: `getSession()`, `requireUser()`, `requireAdmin()` (server-only, `React.cache`). Route helpers `unauthorized()`, `forbidden()` in `lib/http/errors.ts`.
- [ ] **T4 Rate limit** — `lib/http/rateLimit.ts` token bucket keyed by IP (test first: allows N, blocks N+1, refills). Apply to `/api/auth/register`, login action, all `/api/ai/*`.
- [ ] **T5 Invites + admin seed** — `lib/auth/invites.ts` (create/validate/consume; test first: expired, used, wrong token). `prisma/seed.ts` bootstraps ADMIN from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Register route requires valid token; register page reads `?token=`. Admin API `POST/GET /api/admin/invites` + minimal `/admin/invites` page.
- [ ] **T6 Protect everything** — `proxy.ts`: everything requires session except `/`, `/login`, `/register`, `/api/auth/*`, `/api/health`, static. Every existing `app/api/**/route.ts` calls `requireUser()` first. Server actions too.
- [ ] **T7 Security headers + limits** — `next.config.ts`: `output: 'standalone'`, `headers()` with CSP, HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy; `serverActions.bodySizeLimit`; JSON body cap helper `readJson(req, maxBytes)`.
- [ ] **T8 Logger + health** — `lib/http/logger.ts` (pino, JSON in prod, pretty in dev), `withRequestId()`; `GET /api/health` → `{ok, db, version, uptime}`; `instrumentation.ts` logs boot.
- [ ] **T9 Error UI** — `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`.
- [ ] **T10 Container + CI** — `Dockerfile` (multi-stage, standalone, non-root, `migrate deploy` at start), `.dockerignore`, `.github/workflows/ci.yml` (typecheck, lint, test, build with postgres service).
- [ ] **T11 Docs + Notion** — README env table, CHANGELOG entry; move P0 cards to Done; log entry on Notion page.
