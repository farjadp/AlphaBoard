# AlphaBoard — architecture

_Snapshot 2026-10-31 (start of P13). Folder names marked ➜ move in P13c; the shape of the system does not._

## One paragraph

Next.js 16 (App Router, TypeScript, Tailwind 4) on Vercel serves the UI and `app/api/*`. A single leased **worker** (Fly.io, `scripts/worker.ts` bundled to `worker.mjs`) runs every background loop. Both talk to one Postgres (Neon) through Prisma; nothing else holds state. MetaTrader 5 terminals reach the API with a bearer device token (`mql5/SignalCopier.mq5`). AI calls go through one function, `aiJson()`, with model resolution, quotas, usage logging and zod validation.

## Request path

```
browser ─► proxy.ts (nonce CSP, public paths, disclaimer gate)
        ─► app/<page>/page.tsx  ("use client" screens; data via lib/client/resource.ts)
        ─► app/api/**/route.ts  wrapped by route() | userRoute() | userIdRoute() | adminRoute() | deviceRoute()  (lib/http/route.ts, userRoute.ts)
              ├─ requireUser() / requireAdmin()   (lib/auth/dal.ts)
              ├─ await enforceRateLimit()         (lib/http/rateLimit.ts: RateLimitBucket in Postgres, per-instance fallback)
              ├─ readJson(req, maxBytes) + zod    (lib/http/*, lib/db/inputs.ts)
              └─ feature service → prisma         errors: HttpError → { error, code, requestId }
```

Rules: DB access only from `lib/**` (never from `app/**` or `components/**`; P13c adds the ESLint rule); every query is scoped by `userId`; market data only through `lib/market/*` (cached by `marketMemo`, never fabricated — show "unavailable").

## Worker loops (`lib/worker/index.ts`)

| Loop | Period | Does |
|---|---|---|
| lease | renew every 15 s, 45 s TTL | `AppSetting worker.lease`: exactly one process is the worker |
| tick (`lib/jobs/tick.ts` ➜ `lib/worker/tick.ts`) | 60 s | paper settlement (5m candle high/low + quote) → equity snapshots → signal evaluation → price alerts → signal-desk sweep |
| monitor (`lib/sessions/monitor.ts`) | 15 s | agent-session stops/targets (spot price), native-stop sync, loss limit, weekly close, clock |
| reconciler (`lib/exec/reconciler.ts` ➜ `lib/venues/`) | 30 s | venue vs ledger; mismatch halts the session |
| news (`lib/news/job.ts`) | 120 s | ingest, score, shadow index |
| lab (`lib/lab/jobs.ts`) | 5 s | `LabJob` queue (datasets, studies, DCA baskets) |
| telegram (`lib/notify/telegramBot.ts`) | long-poll 25 s | link codes, `/sessions`, `/positions`, inline buttons |

Kill switches: `TICK_DISABLED`, `NEWS_DISABLED`, `LAB_DISABLED`, `TRADING_HALT`, `WORKER_MODE`.

## Feature map (`lib/`)

| Area | Folders | Notes |
|---|---|---|
| Auth & access | `auth/`, `access/`, `legal/`, `secrets/` | invite-only, disclaimer gate, AES-GCM for exchange keys |
| Market data | `market/`, `assetCatalog.ts` ➜ `market/catalog.ts`, `candlestickPatterns.ts` + `chartPatterns.ts` ➜ `market/patterns/`, `binance.ts` ➜ `format/` | Binance, Yahoo, OANDA candles; indicators; hours |
| AI | `ai/` (providers, catalog, `aiJson`, prompts), `agents/` ➜ `sessions/desk/` | desk cast, prompts, runners |
| Analyses (archive) | `db/signals.ts`, `eval/` | AI analyses = Prisma `Signal`; graded by `eval` |
| Journal | `journal/`, `db/journal.ts`, `db/lessons.ts`, `db/chartLessons.ts` | P&L helper, post-mortems, academy lessons |
| Paper trading | `paper/` | engine (fills, SL/TP scan, liquidation) + account service |
| Agent sessions | `sessions/`, `risk/`, `venues/`, `exchanges/` ➜ `venues/connections.ts`, `exec/` ➜ `venues/reconciler.ts` | mandate → cycle → risk verdict → venue; monitor; report |
| Signal Desk (Telegram + MT5) | `signals/` ➜ `signalDesk/`, `mt5/devices.ts` ➜ `signalDesk/devices.ts` | validate → post to channel → EA claims → reports → state |
| Strategy Lab | `lab/`, `mt5/{deals,import}.ts` ➜ `lab/data/mt5` | bars, ladders, robustness, DCA, edge-vs-random |
| News hub | `news/` | sources, weights agent, shadow index |
| Alerts & notify | `alerts/` + `db/alerts.ts` ➜ `alerts/`, `notify/` | price alerts; Notification model; Telegram senders |
| Platform | `http/`, `env.ts`, `format/`, `trading/`, `db/`, `prisma.ts` ➜ `db/client.ts`, `config/`, `ops/`, `worker/`, `jobs/` ➜ `worker/`, `client/`, `types/` ➜ per feature | route wrappers, validated env, formatting, trade math, logger, rate limit, health, overview |

`components/` mirrors the features (`paper/`, `sessions/`, `market/`, `admin/{lab,news,signals,system}`, `settings/`, `shell/`); P13c moves the four loose files at its root into those folders and renders `NavBar` once from a route-group layout. P13d splits the oversized client pages (journal, academy, LabWorkbench, SessionRoom, setup, alerts).

## Positions (three worlds today, one core after P14)

| | Paper | Agent sessions | MT5 Signal Desk |
|---|---|---|---|
| Model | `PaperPosition` | `SessionPosition` (+ `exitPlan` JSON, best/worst price) | `TradeSignal` + `TradeSignalLeg` (one leg per TP) |
| Exit check | tick, candle high/low | monitor, spot price | broker SL/TP on the terminal |
| Manage | SL/TP edit, close | close, close half, breakeven, AI tighten | breakeven after TP1, CLOSE_ALL |

P14 adds `lib/trading/positions/` (one `scanExit`, `breakeven`, `trail`, `tpLadder`, MFE/MAE), native TP on venues, SignalCopier 1.13+ (buffered breakeven, trailing, partial close, `MOVE_SL`/`MOVE_TP`, position snapshot in the heartbeat) and a single `/positions` page.

## Data

- One `prisma/schema.prisma` (42 models), 26 migrations, applied only by `prisma migrate deploy` (Vercel production builds; the Fly entrypoint still does too until P13e). Never `db push` against production.
- Encrypted at rest: exchange API keys (`ExchangeConnection`, `EXCHANGE_KEY_SECRET`). Device tokens for MT5 are hashed (`Mt5Device`).

## Verification before shipping

1. `npm run typecheck && npm run lint && npm run test:db && npm run build` (CI runs the same on every PR).
2. Infra or migration change → production image test: `docker build -t alphaboard:test .`, run it against a fresh local DB (`alphaboard_deploytest`) with `TICK_DISABLED=1`, expect all migrations, `[seed] admin ready`, `/api/health` ok; then remove container, image and DB.
3. Behaviour change → check it in the running app with real data (`npm run build && npm start -- -p 3001`), then delete any synthetic rows.
