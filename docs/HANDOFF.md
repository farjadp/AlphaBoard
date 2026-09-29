# AlphaBoard v2 — Session Handoff

_Last updated: 2026-09-29 · branch `v2` · **v2.1.0** pushed, PR #3 → `main` open (merge = deploy)_

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
| P6 · Alerts | ✅ Done | Alerts fire server-side in the tick (5m candle high/low + quote, once, with trigger price); `Notification` model + bell in NavBar (also for paper SL/TP/liquidation closes); optional Telegram (`TELEGRAM_BOT_TOKEN`, link via `/start CODE` from Settings, `getUpdates` in the tick, `/stop` unlinks, blocked bot auto-unlinks). Clients can no longer mark alerts triggered |
| P7 · UI & release | ✅ Done | Light redesign, risk-disclaimer gate + `/legal` + footer, public landing + waitlist + SEO, Admin → System (health, errors), track record on the ticket, accessibility audit 15→19/20 (axe 0 violations), CHANGELOG/README, version 2.0.0 + tag `v2.0.0` |
| Release v2.1.0 | ⏳ PR #3 open | https://github.com/farjadp/AlphaBoard/pull/3 — image pre-tested on an empty DB (15 migrations, admin seeded, health ok). Farjad merges → Railway deploys; then check `/api/health` |
| P8a · Agent sessions (paper) | ✅ Done | Mandate → desk room (analysts, optional debate, strategist) → deterministic risk engine → paper venue; 15 s monitor (stops, loss limit, end prompt + 5-min timeout), journal lessons, report; interactive Telegram; leased worker. Spec `docs/superpowers/specs/2026-09-28-p8-agent-trading-sessions-design.md`, plan `docs/superpowers/plans/2026-09-28-p8a-sessions-on-paper.md`, research `docs/superpowers/research/2026-09-28-p8-agents-exchanges.md` |
| P8b · Live via ccxt | ✅ Done (verified on Binance Spot Testnet) | Encrypted exchange connections (Settings), ccxt venue (spot + perp, market orders, intent-first client ids, lookup on unknown outcome), halt on unknown orders, 30 s reconciler, `TRADING_HALT`, gating (`LIVE_TRADING_ENABLED` + `EXCHANGE_KEY_SECRET`, admin, typed LIVE for real money). Plan `docs/superpowers/plans/2026-09-29-p8b-live-ccxt.md`. Testnet run 2026-09-29: real orders filled (7582599 buy, partial close, kill), exchange orders matched the ledger 1:1, reconciler clean, software stop fired a market SELL (7585120); test data removed, the testnet connection kept in Settings. Opt-in test `tests/db/binanceTestnet.test.ts` |
| News hub | ✅ Done (branch `feat/news-hub`) | Multi-source news (Finnhub, Alpha Vantage, Marketaux, NewsAPI, RSS, Yahoo, CryptoPanic v2), de-dup, weighted headlines, weekly publisher-weights agent with code limits + change log, shadow news index with 4 h/24 h evaluation, Admin → News. Plan `docs/superpowers/plans/2026-09-29-news-hub.md`; spec in Notion |
| P8c · Native stops | ✅ Done (verified on Binance Spot Testnet) | Stop-loss orders rest on the exchange where ccxt supports them (Binance, Bybit, OKX, Coinbase); replaced on tighten, cancelled before any close, fills booked from the exchange; software fallback with 0.3% slack. Bundled worker (`npm run build:worker` → `dist/worker.mjs`, in the image as `worker.mjs`). Plan `docs/superpowers/plans/2026-09-29-p8c-native-stops.md` |
| **P9 · Forex & metals** | ✅ Built; first live session waits for Farjad | OANDA v20 venue (`lib/venues/oanda.ts`): FOK market orders with broker stop on fill, OPEN_ONLY, client-id + transaction lookup, broker P&L, stop/closeout detection, trade reconciler; OANDA connections in Settings; forex/metals symbols; AI skipped while markets are closed. Plan `docs/superpowers/plans/2026-09-29-p9-oanda.md`. Farjad's token turned out to be for the **live** CAD account: local connection "OANDA live (Primary)" (001-002-21512146-002, C$100) is verified read-only; `-001` is MT4-linked, so never use it. Home-currency conversion was added (XAU_USD/XAG_USD on CAD). Claude does not execute real-money trades: Farjad starts the LIVE session (suggested EUR/USD + XAG/USD, capital 80, risk 2%, loss limit 5, 1 h) and Claude monitors. MT5 bridge not started |

Quality gates at handoff: **299 tests passing** (`npm run test:db`), `tsc` clean, ESLint 0 problems, production build clean. P8a was verified live: a paper session on BTC/ETH with real data and gpt-5.4-mini (debate on) — cycle, verdicts, fill, partial close from the UI, end prompt, 5-minute timeout, journal lesson and report; the test data was deleted afterwards.

## Local environment

- Work in **`~/Developer/alphaboard`** (not the Google Drive copy: its path — spaces + `@` — makes vitest hang). Remotes: `origin` = GitHub, `drive` = old Drive folder. `v2` is **not pushed** to GitHub yet.
- Dev Postgres: `docker compose up -d db` → `localhost:5434` (5432/5433 are taken by other projects). Test schema: `?schema=test` (used by `npm run test:db`).
- Run the app: preview config `.claude/launch.json` → `npm start -- -p 3001` (port 3000 belongs to another project). Rebuild (`npm run build`) after code changes before `npm start`.
- Secrets: `.env` (DB, AUTH_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD for the local admin) and `.env.local` (API keys only: OpenAI, NewsAPI, Finnhub, Alpha Vantage, Marketaux — never production values). Both git-ignored. Only OpenAI is configured; Anthropic/OpenRouter/DeepSeek need keys for live tests.
- Local admin login: `ADMIN_EMAIL` in `.env`; password is the local test password set in `.env` (`ADMIN_PASSWORD`).

## Gotcha: `prisma migrate dev` in this (non-interactive) shell

It aborts when Prisma wants a confirmation (e.g. adding a unique index). Workaround used for `20260928190000_alerts_notifications`: create a temp DB `alphaboard_shadow`, `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …/alphaboard_shadow --script > prisma/migrations/<ts>_<name>/migration.sql`, drop the temp DB, then `prisma migrate deploy` + `prisma generate`.

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

## Worker (tick, sessions, Telegram)

- `lib/worker/index.ts` `startWorker()`: a lease row (`AppSetting worker.lease`, 45 s, renewed every 15 s) makes exactly one process the worker; another takes over when it expires. Heartbeat: `AppSetting worker.last`.
- `WORKER_MODE=inline` (default) → started by `instrumentation.ts` in the web process. `WORKER_MODE=separate` → the web process starts nothing; run `npm run worker` (Node with `--conditions=react-server` so `server-only` resolves, loads `.env` + `.env.local`). A bundled production worker image comes with P8b (ccxt).
- Loops: `runTick()` every 60 s (`TICK_DISABLED=1` turns only this off; `POST /api/cron/tick` still works), `monitorSessions()` every 15 s, Telegram `getUpdates` long-poll (25 s).
- `runTick()` in `lib/jobs/tick.ts`: paper settlement (+ notifications) → equity snapshots → signal evaluation (P5) → price alerts (P6). Each part has its own try/catch.

## Exchange sessions (P8b/P8c)

- **Native stops (P8c):** `ccxtVenue` places a `stopLossPrice` market order after every entry when `features.<spot|swap.linear>.createOrder.stopLossPrice` is true. A resting stop is a `SessionOrder` (purpose STOP, type `stop_market`, status OPEN). `setStop` cancels and re-places it; `closePosition` cancels it first and, if it had already filled, books that fill instead of selling again; `syncStops` (monitor, every 15 s) books stops that fired. The software stop only acts 0.3% past a native stop (`NATIVE_STOP_SLACK`). Take-profit is still software. Testnet run 2026-09-29: the real AI opened BTC and ETH positions itself, the stop rested on Binance, the tightened stop was cancelled and re-placed, Binance filled it and the monitor booked it once, and kill cancelled the stop before selling.
- **Separate worker in production:** the image contains `worker.mjs`. For a second Railway service, use the same image with start command `node worker.mjs` and no HTTP healthcheck; set `WORKER_MODE=separate` on the web service. Until then the inline worker stays the default.
- **MEXC (researched 2026-09-29):** futures API orders reopened for KYC'd users on 2026-03-31 and work with ccxt ≥ 4.5.56 (we pin 4.5.84). There is no API sandbox, spot stop orders cannot be placed via the API (so software stops only), and ccxt's unified swap stop flag is still false (software stops). **MEXC's terms exclude Canada**, so an Ontario resident cannot legitimately use it; the code is not special-cased.

- Local `.env.local` has `LIVE_TRADING_ENABLED=1` and a generated `EXCHANGE_KEY_SECRET` (changing the secret makes stored keys unreadable → re-add connections). Production has neither yet.
- `lib/venues/ccxtClient.ts` caches one ccxt instance per connection + key version (sandbox set before any call, rate limit on, time sync, recvWindow 5 s); tests inject a fake via `setExchangeFactory` (`tests/setup/fakeExchange.ts`).
- Catalog symbols map to `BASE/<quote>` (spot) or `BASE/<quote>:<quote>` (swap); exchange sessions are crypto only (forex/metals → P9 OANDA).
- Exchange sessions price everything (stops, marks, risk) from the exchange ticker; agents still read market data from `lib/market`.
- Unknown order outcome → `haltSession(RECONCILE_MISMATCH)`; the monitor then closes the remaining positions. The owner should check the exchange by hand.

## News hub

- `lib/news/`: `sources.ts` (adapters + budgets), `ingest.ts` (targets = watchlists + unfinished sessions + default watchlist; state in `AppSetting news.providers`), `read.ts` (ranked headlines), `measure.ts` (hourly snapshots, returns from 1H candles 24 h later, reports), `weights.ts` (weekly agent, `feature: news.weights`, billed to the first admin), `job.ts` (worker loop every 2 min; `NEWS_DISABLED=1` turns it off; last pass in `AppSetting news.last`).
- `getNews()` reads the hub; when the hub has nothing for a symbol it fetches that symbol's Yahoo feed once and stores it.
- Shadow rule: the news index number is never given to trading agents. Revisit after ≥ 4 weeks of evaluation with Farjad (Admin → News shows hit rates and correlation).
- Keys: `FINNHUB_KEY`, `ALPHAVANTAGE_KEY`, `MARKETAUX_KEY` (free plans; set locally and in Railway 2026-09-29), `NEWS_API_KEY`, optional `CRYPTOPANIC_KEY` + `CRYPTOPANIC_PLAN`.
- Yahoo per-symbol feeds are loose (mining stocks under gold), so they count as title-level relevance, not tags. Yahoo-syndicated items all share the publisher "Yahoo Finance".

## Agent sessions (P8a)

- Flow per cycle (`lib/sessions/cycle.ts`): triggers (interval, a close since the last cycle, ≥1.5% move; a quiet all-hold interval is skipped at most twice) → context block (`lib/agents/context.ts`, "unavailable" instead of guesses) → analysts (market + news, parallel) → optional debate → strategist (exit plan per entry) → `evaluateProposal` (`lib/risk/verdict.ts`) → paper venue (`lib/venues/paper.ts`, idempotent `clientOrderId`) → room messages.
- Monitor (`lib/sessions/monitor.ts`): stops/targets/liquidation on live prices, loss limit (realized + unrealized − fees) → HALTED + flatten, end → AWAITING_EXTENSION + prompt → timeout → `onEnd`; retries closes without a price; journals closed trades and writes the report in the background.
- AI prompts spell out their JSON shape (`SHAPES` in `lib/agents/prompts.ts`) because OpenAI runs in `json_object` mode; zod validates every answer. Per-role models via `AiRequest.model`.
- Agent failure → no trading that cycle, retry in 2 min; 3 in a row → PAUSED. AI budget reached → no more cycles, stops keep running.
- Limits: at most 3 active sessions per user; daily limits in `UserTradingLimits`; live mode refused until P8b.

## Telegram (optional)

1. Create a bot with @BotFather, put the token in `TELEGRAM_BOT_TOKEN` (never commit it).
2. Users link in Settings → Telegram: they send `/start CODE` (or tap the deep link); the worker links the chat within seconds.
3. Linked chats get `/sessions`, `/positions`, `/pause`, `/resume`, `/kill` and inline buttons (`TelegramAction` tokens: single use, 24 h, bound to the owner's chat; kill/close ask for confirmation). The end-of-session prompt is edited with the outcome.
4. Uses `getUpdates` long-polling from the single worker — do not also set a webhook on that bot (Telegram rejects getUpdates while a webhook is set).
