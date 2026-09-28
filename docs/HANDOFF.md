# AlphaBoard v2 — Session Handoff

_Last updated: 2026-09-28 · branch `v2` · after P5_

Read this first in a new session. Source of truth for the plan: `docs/superpowers/specs/2026-09-27-alphaboard-v2-design.md`.
Project tracker (Kanban): Notion → AlphaBoard page (links at the bottom).

## Where things stand

| Phase | Status | Summary |
|---|---|---|
| P0 · Foundation | ✅ Done | Invite-only auth, `requireUser/requireAdmin` DAL, rate limits, nonce-based CSP + security headers, pino logs, `/api/health`, Prisma migrations (`migrate deploy`), Dockerfile, CI |
| P1 · Data integrity | ✅ Done | `lib/market` services (cached), real intraday data for all assets, trend vs stretch scoring, all mocks removed, futures/long-short via Binance→Bybit→OKX, zod-validated AI output |
| P2 · Persistence | ✅ Done | All user data in Postgres (7 models), owner-only attachments, resource store with optimistic UI, `/import` for v1 browser data, account menu |
| P3 · AI providers | ✅ Done | `lib/ai`: OpenAI / Anthropic (official SDK, structured outputs) / OpenRouter / DeepSeek, verified price catalog, `AiUsage` logging, per-user daily token quota, `/settings`, `/admin/ai`, `/admin/users` |
| P4 · Paper trading | ✅ Done | `lib/paper` engine (isolated margin, 0.05% fee + 0.05% slippage, liquidation, SL/TP on 5m candle high/low + live quote), 60s tick (`lib/jobs`, `instrumentation.ts`, `POST /api/cron/tick`), `/paper` (ticket, positions, history, equity curve, reset), "Trade on paper" from Archive signals. Plan: `docs/superpowers/plans/2026-09-28-p4-paper-trading.md` |
| P5 · Signal evaluation | ✅ Done | `lib/eval` (evaluator, metrics, job in the tick), `SignalEvaluation` model, `/performance` (win rate, expectancy, profit factor, drawdown, cumulative R, calibration, breakdowns, URL filters), outcome badges in Archive. Rules: `docs/superpowers/plans/2026-09-28-p5-signal-evaluation.md` |
| **P6 · Alerts** | ⏭ **Next** · Partial | Client bugs fixed in P1; still only evaluates while `/alerts` is open → move to the tick job + notification center + optional Telegram |
| P7 · UI & release | Pending | Tailwind tokens (remove inline styles), Manrope font, drop purple gradients, landing + SEO, disclaimer acceptance, a11y, `/impeccable` audit, tag `v2.0.0` |

Quality gates at handoff: **173 tests passing** (`npm run test:db`), `tsc` clean, ESLint 0 problems (all rules on), production build clean.

## Local environment

- Work in **`~/Developer/alphaboard`** (not the Google Drive copy: its path — spaces + `@` — makes vitest hang). Remotes: `origin` = GitHub, `drive` = old Drive folder. `v2` is **not pushed** to GitHub yet.
- Dev Postgres: `docker compose up -d db` → `localhost:5434` (5432/5433 are taken by other projects). Test schema: `?schema=test` (used by `npm run test:db`).
- Run the app: preview config `.claude/launch.json` → `npm start -- -p 3001` (port 3000 belongs to another project). Rebuild (`npm run build`) after code changes before `npm start`.
- Secrets: `.env` (DB, AUTH_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD for the local admin) and `.env.local` (OPENAI_API_KEY, NEWS_API_KEY). Both git-ignored. Only OpenAI is configured; Anthropic/OpenRouter/DeepSeek need keys for live tests.
- Local admin login: `ADMIN_EMAIL` in `.env`; password is the local test password set in `.env` (`ADMIN_PASSWORD`).

## Conventions that matter

- Next.js 16: read `node_modules/next/dist/docs/` before using an API (`proxy.ts` replaces middleware; nonce CSP requires request-time rendering — root layout is `force-dynamic`).
- Every route handler: `route()` / `userRoute()` wrapper → `requireUser()` → `enforceRateLimit()`; bodies via `readJson(req, maxBytes)`; errors as `HttpError` → `{ error, code, requestId }`.
- DB access only via `lib/db/*` (server-only, `userId` on every query). DTO shapes live in `lib/types/userData.ts`.
- Client data via `lib/client/resource.ts` (`useSyncExternalStore`), never `setState` in effects (ESLint enforces it).
- AI calls only via `aiJson()` in `lib/ai/index.ts` (model resolution, quota, usage logging, zod validation). Give it `jsonSchema` from `lib/ai/jsonSchemas.ts`.
- Market data only via `lib/market/*` (cached with `marketMemo`); never fabricate or fall back to fake values — show "unavailable".
- TDD: failing test first; DB behaviour in `tests/db/*` (skipped unless `TEST_DATABASE_URL`).
- Commits end with the Co-Authored-By trailer; keep the Notion Kanban and its "لاگ به‌روزرسانی" updated after each phase.

## Before the first production deploy (Railway project `AlphaBoard-Trading`)

1. Reset the production database (it was created with `db push`, has no migration history); the seed recreates the admin.
2. Set env: `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, AI keys, optional `CRON_SECRET`. Keep a single replica (the tick is in-process).
3. Push `v2`, let CI pass, open a PR to `main`.

## Decisions taken (2026-09-28)

- Default AI model → `gpt-5.4-mini` (built-in default; vision model stays `gpt-4o`). An admin value saved in Admin → AI still wins.
- Claude Opus 5 refusal fallbacks stay on; every fallback is recorded (`AiUsage.fallbackFrom`) and shown in Admin → AI (Fallbacks column, `requested → served` in By model).

## Tick job

- Runs every 60s in-process (single instance). Disable with `TICK_DISABLED=1`; external trigger: `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` (or an admin session). Last run: `tick` on `/api/health`.
- `runTick()` in `lib/jobs/tick.ts` runs paper settlement, then signal evaluation (P5); P6 alerts plug in the same way (isolated try/catch per part).
