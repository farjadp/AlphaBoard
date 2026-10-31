# AlphaBoard v2 — Session Handoff

_Last updated: 2026-10-31 · Everything through P12 (Signal Desk, SignalCopier 1.12) is live on `main` · **P13 Clean House + P14 Positions** in progress on `feat/p13-clean-house` · plan `docs/superpowers/plans/2026-10-31-p13-clean-house-and-p14-positions.md`_

Read this first in a new session. Current layout and data flow: `docs/ARCHITECTURE.md`. Original design spec: `docs/superpowers/specs/2026-09-27-alphaboard-v2-design.md`. Finished phase plans are in `docs/archive/plans/`.
Project tracker (Kanban): Notion → AlphaBoard page (links at the bottom).

## Where things stand

| Phase | Status | Summary |
|---|---|---|
| P0 · Foundation | ✅ Done | Invite-only auth, `requireUser/requireAdmin` DAL, rate limits, nonce-based CSP + security headers, pino logs, `/api/health`, Prisma migrations (`migrate deploy`), Dockerfile, CI |
| P1 · Data integrity | ✅ Done | `lib/market` services (cached), real intraday data for all assets, trend vs stretch scoring, all mocks removed, futures/long-short via Binance→Bybit→OKX, zod-validated AI output |
| P2 · Persistence | ✅ Done | All user data in Postgres (7 models), owner-only attachments, resource store with optimistic UI, `/import` for v1 browser data, account menu |
| P3 · AI providers | ✅ Done | `lib/ai`: OpenAI / Anthropic (official SDK, structured outputs) / OpenRouter / DeepSeek, verified price catalog, `AiUsage` logging, per-user daily token quota, `/settings`, `/admin/ai`, `/admin/users` |
| P4 · Paper trading | ✅ Done | `lib/paper` engine (isolated margin, 0.05% fee + 0.05% slippage, liquidation, SL/TP on 5m candle high/low + live quote), 60s tick (`lib/jobs`, `instrumentation.ts`, `POST /api/cron/tick`), `/paper` (ticket, positions, history, equity curve, reset), "Trade on paper" from Archive signals. Plan: `docs/archive/plans/2026-09-28-p4-paper-trading.md` |
| P5 · Signal evaluation | ✅ Done | `lib/eval` (evaluator, metrics, job in the tick), `SignalEvaluation` model, `/performance` (win rate, expectancy, profit factor, drawdown, cumulative R, calibration, breakdowns, URL filters), outcome badges in Archive. Rules: `docs/archive/plans/2026-09-28-p5-signal-evaluation.md` |
| P6 · Alerts | ✅ Done | Alerts fire server-side in the tick (5m candle high/low + quote, once, with trigger price); `Notification` model + bell in NavBar (also for paper SL/TP/liquidation closes); optional Telegram (`TELEGRAM_BOT_TOKEN`, link via `/start CODE` from Settings, `getUpdates` in the tick, `/stop` unlinks, blocked bot auto-unlinks). Clients can no longer mark alerts triggered |
| P7 · UI & release | ✅ Done | Light redesign, risk-disclaimer gate + `/legal` + footer, public landing + waitlist + SEO, Admin → System (health, errors), track record on the ticket, accessibility audit 15→19/20 (axe 0 violations), CHANGELOG/README, version 2.0.0 + tag `v2.0.0` |
| Release v2.1.0 | ✅ Live 2026-09-29 (PR #3) | https://github.com/farjadp/AlphaBoard/pull/3 — image pre-tested on an empty DB (15 migrations, admin seeded, health ok). merged by Farjad; the image was pre-tested on an empty DB |
| P8a · Agent sessions (paper) | ✅ Done | Mandate → desk room (analysts, optional debate, strategist) → deterministic risk engine → paper venue; 15 s monitor (stops, loss limit, end prompt + 5-min timeout), journal lessons, report; interactive Telegram; leased worker. Spec `docs/superpowers/specs/2026-09-28-p8-agent-trading-sessions-design.md`, plan `docs/archive/plans/2026-09-28-p8a-sessions-on-paper.md`, research `docs/superpowers/research/2026-09-28-p8-agents-exchanges.md` |
| P8b · Live via ccxt | ✅ Done (verified on Binance Spot Testnet) | Encrypted exchange connections (Settings), ccxt venue (spot + perp, market orders, intent-first client ids, lookup on unknown outcome), halt on unknown orders, 30 s reconciler, `TRADING_HALT`, gating (`LIVE_TRADING_ENABLED` + `EXCHANGE_KEY_SECRET`, admin, typed LIVE for real money). Plan `docs/archive/plans/2026-09-29-p8b-live-ccxt.md`. Testnet run 2026-09-29: real orders filled (7582599 buy, partial close, kill), exchange orders matched the ledger 1:1, reconciler clean, software stop fired a market SELL (7585120); test data removed, the testnet connection kept in Settings. Opt-in test `tests/db/binanceTestnet.test.ts` |
| News hub | ✅ Done (branch `feat/news-hub`) | Multi-source news (Finnhub, Alpha Vantage, Marketaux, NewsAPI, RSS, Yahoo, CryptoPanic v2), de-dup, weighted headlines, weekly publisher-weights agent with code limits + change log, shadow news index with 4 h/24 h evaluation, Admin → News. Plan `docs/archive/plans/2026-09-29-news-hub.md`; spec in Notion |
| P8c · Native stops | ✅ Done (verified on Binance Spot Testnet) | Stop-loss orders rest on the exchange where ccxt supports them (Binance, Bybit, OKX, Coinbase); replaced on tighten, cancelled before any close, fills booked from the exchange; software fallback with 0.3% slack. Bundled worker (`npm run build:worker` → `dist/worker.mjs`, in the image as `worker.mjs`). Plan `docs/archive/plans/2026-09-29-p8c-native-stops.md` |
| **P9 · Forex & metals** | ✅ Built; first live session waits for Farjad | OANDA v20 venue (`lib/venues/oanda.ts`): FOK market orders with broker stop on fill, OPEN_ONLY, client-id + transaction lookup, broker P&L, stop/closeout detection, trade reconciler; OANDA connections in Settings; forex/metals symbols; AI skipped while markets are closed. Plan `docs/archive/plans/2026-09-29-p9-oanda.md`. Farjad's token turned out to be for the **live** CAD account: local connection "OANDA live (Primary)" (001-002-21512146-002, C$100) is verified read-only; `-001` is MT4-linked, so never use it. Home-currency conversion was added (XAU_USD/XAG_USD on CAD). Claude does not execute real-money trades: Farjad starts the LIVE session (suggested EUR/USD + XAG/USD, capital 80, risk 2%, loss limit 5, 1 h) and Claude monitors. MT5 bridge not started |
| **P10 · Desk discipline** | ✅ Live since 2026-10-07 | Lessons from the first live OANDA week, which went 0 for 5 trades: C$-2.31 on the trades plus about $5.45 of AI cost. Plan: `docs/archive/plans/2026-10-06-p10-desk-discipline.md`. **Data bug fixed:** Yahoo gap bars came through as 0 prices, which poisoned ATR, RSI, EMA and trend for FX and metals (EUR/USD 1H ATR read 93 pips instead of 13). **Close-retry bug fixed:** a close the broker refused was never resent, so USD/CAD was held over the weekend. The risk engine now requires a stop ≥ 1.5× the 1H ATR, conviction ≥ 0.7, no entry against the 4H trend, the market analyst agreeing at ≥ 60%, and no opposite exposure to a currency already held; stops tighten only after 1R and stay ≥ 1 ATR from the price. **Weekly close:** no FX or metals entry or session start in the last hour; positions are closed 20 min before it (`MARKET_CLOSE`) and all-FX sessions end. Cycles with no setup skip the debate and the strategist. The journal gets MFE/MAE in R plus the stop distance in ATR, and writes its lessons as testable rules. The report's R and margin are now in the account currency, and no USD amount is netted against CAD. 2 migrations (enum `MARKET_CLOSE`, `SessionPosition.bestPrice/worstPrice`) |
| **P11b · Strategy Lab** | ✅ Live since 2026-10-20 | `lib/lab` engine (bars, ladder set, account with money rules, robustness, DCA, metrics) golden-checked against the research (`tests/unit/labGolden.test.ts`, opt-in `LAB_GOLDEN_DIR`). Data: OANDA bid/ask candles, Binance klines, MT5 ExportM1 upload → `LabDataset` (gzip Float64 columns, 10 per user, 40 MB). `LabJob` queue run by the worker's `lab` loop (5 s, `LAB_DISABLED=1` turns it off). Page `/admin/lab` (admin only). The upload route is outside the proxy matcher, because the proxy truncates bodies over 10 MB without an error. OANDA paging gotcha: `includeFirst=false` returns count − 1 candles. Plans: `docs/archive/plans/2026-10-20-p11b1-lab-engine.md`, `…-p11b2-lab-data.md`. P11c MT5 bridge (ExportDeals → Mt5Trade + journal, edge check vs random) and P11b-4 DCA baskets (`LabBasket`/`LabBasketSymbol` from data.binance.vision, FETCH via a BASKET job) followed. All of P11a/b/c live since 2026-10-20 (`main` e88586c); P11b-4 on `feat/p11b4-dca-lab` |
| **P11a · Money management + honest drawdown** | ✅ Live since 2026-10-20 | From the 2026-10-20 research (entries ≈ random on Farjad's broker data; money management decides the outcome; a crypto DCA bot hid a 95% drawdown behind a green realized curve). Risk engine: no entries after `maxConsecLosses` losing trades in a row today (UTC, default 2) and none for `lossCooldownMin` after any losing close (default 30); exits never blocked; strategist told when entries are closed. Monitor records `equityPeak` / `maxDrawdownMtm` (open positions marked); the report shows it first and the closed-trades figure second. 1 migration. Sessions started earlier keep both guards off (`mandateOf` casts, no defaults). Next: P11b Strategy Lab (architecture fixed in the P11 plan) |
| **P12 · Signal Desk** | ✅ Live (PRs #8–#16; SignalCopier 1.12: symbol map, day reset, capped min-lot) | Farjad writes a signal in Admin → Signals; AlphaBoard posts it to the Telegram channel (@gheymat_today via `SIGNAL_BOT_TOKEN`) and `mql5/SignalCopier.mq5` executes it in MT5. One position per TP with a broker-side SL/TP, at-most-once claim (`PENDING → SENT`), UNKNOWN after 2 min of silence and no retry, expiry after 10 min, dry run and a real-account refusal by default. Verified: unit + DB tests, the EA routes with curl, the page in the browser with a fake terminal; the EA compiles with 0 errors and 0 warnings. **Not yet run in a real terminal** (Task 8 of the plan). Runbook below |
| **P13 · Clean House / P14 · Positions** | ⏳ P13a live; P13b (#18), P14a+P14d (#19), P14c (#20) in PRs | Refactor in place, no rewrite. P13a repo hygiene + docs → P13b shared modules (`lib/env`, `lib/format`, `lib/trading/math`, `adminRoute`) → P14a shared position core + P14d SignalCopier 1.13 (breakeven buffer, trailing, partial close, MOVE_SL/MOVE_TP) → P14c sessions (native TP, candle scan) → P13c folder moves → P14b/e paper + one `/positions` page → P13d page splits → P13e worker image. Plan: `docs/superpowers/plans/2026-10-31-p13-clean-house-and-p14-positions.md` |

Quality gates at P11b: **499 tests passing** (`npm run test:db`), `tsc` and ESLint clean, build clean; verified in the running app (one year of OANDA XAU/USD M1 downloaded and studied; 15 MB upload whole). Quality gates at P11a: **436 tests passing** (`npm run test:db`), `tsc` and ESLint clean, build clean; verified in the app (form → mandate JSON, room mandate box, live MTM drawdown on a paper session; test data deleted).

Quality gates at P10 handoff: **414 tests passing**, `tsc` and ESLint clean, build clean. (At P8a: 299 tests passing (`npm run test:db`), `tsc` clean, ESLint 0 problems, production build clean.) P8a was verified live: a paper session on BTC/ETH with real data and gpt-5.4-mini (debate on) — cycle, verdicts, fill, partial close from the UI, end prompt, 5-minute timeout, journal lesson and report; the test data was deleted afterwards.

## Local environment

- Work in **`~/Developer/alphaboard`** (not the Google Drive copy: its path — spaces + `@` — makes vitest hang). Remote `origin` = GitHub (`drive` is the old Drive folder, read-only history). **Branch model since 2026-10-31:** `main` is production (Vercel deploys it); every change is a `feat/*` or `fix/*` branch → PR → Farjad merges. `v2` is retired.
- Dev Postgres: `docker compose up -d db` → `localhost:5434` (5432/5433 are taken by other projects). Test schema: `?schema=test` (used by `npm run test:db`).
- Run the app: preview config `.claude/launch.json` → `npm start -- -p 3001` (port 3000 belongs to another project). Rebuild (`npm run build`) after code changes before `npm start`.
- Secrets: `.env` (DB, AUTH_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD for the local admin) and `.env.local` (API keys only: OpenAI, NewsAPI, Finnhub, Alpha Vantage, Marketaux — never production values). Both git-ignored. Only OpenAI is configured; Anthropic/OpenRouter/DeepSeek need keys for live tests.
- Local admin login: `ADMIN_EMAIL` in `.env`; password is the local test password set in `.env` (`ADMIN_PASSWORD`).

## Gotcha: `prisma migrate dev` in this (non-interactive) shell

It aborts when Prisma wants a confirmation (e.g. adding a unique index). Workaround used for `20260928190000_alerts_notifications`: create a temp DB `alphaboard_shadow`, `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …/alphaboard_shadow --script > prisma/migrations/<ts>_<name>/migration.sql`, drop the temp DB, then `prisma migrate deploy` + `prisma generate`.

## Conventions that matter

- Next.js 16: read `node_modules/next/dist/docs/` before using an API (`proxy.ts` replaces middleware; nonce CSP requires request-time rendering — root layout is `force-dynamic`).
- Every route handler: `route()` / `userRoute()` / `adminRoute()` / `deviceRoute()` wrapper (auth + `await enforceRateLimit()` inside); bodies via `readJson(req, maxBytes)`; errors as `HttpError` → `{ error, code, requestId }`. Environment only via `lib/env.ts`; numbers via `lib/format`; trade arithmetic via `lib/trading/math`.
- DB access only via `lib/db/*` and feature services (server-only, `userId` on every query). DTO shapes live in `lib/db/types.ts`.
- Client data via `lib/client/resource.ts` (`useSyncExternalStore`), never `setState` in effects (ESLint enforces it).
- AI calls only via `aiJson()` in `lib/ai/index.ts` (model resolution, quota, usage logging, zod validation). Give it `jsonSchema` from `lib/ai/jsonSchemas.ts`.
- Market data only via `lib/market/*` (cached with `marketMemo`); never fabricate or fall back to fake values — show "unavailable".
- TDD: failing test first; DB behaviour in `tests/db/*` (skipped unless `TEST_DATABASE_URL`).
- Commits end with the Co-Authored-By trailer; keep the Notion Kanban and its "لاگ به‌روزرسانی" updated after each phase.

## Production (since 2026-10-22: Vercel + Neon + Fly.io)

- **Web:** Vercel project `alphaboard` (team `ashavidproject`), Git-linked to `farjadp/AlphaBoard`, production branch `main`. Domain https://alphaboard.trade (`www.` → 308 to the apex, so EA/WebRequest clients use the apex). Build = `scripts/vercel-build.sh`: on production deploys only it runs `prisma migrate deploy` over `DATABASE_URL_UNPOOLED`, then `next build`. Previews share the production DB and never migrate. `/api/health` `version` = Vercel commit sha. `WORKER_MODE=separate`, so the web process starts no worker.
- **DB:** Neon (us-east-1) through the Vercel Marketplace integration, which injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct; needed by `migrate deploy`).
- **Worker:** Fly.io app `alphaboard-worker`, one machine in `iad`, `fly.toml` runs `node worker.mjs` from the repo `Dockerfile` (the entrypoint also runs `migrate deploy` + seed; P13e removes that so only Vercel migrates). Deploy from the repo root: `flyctl deploy -a alphaboard-worker --ha=false --remote-only`. Its `DATABASE_URL` is the **unpooled** URL. Loops: tick 60 s, session monitor 15 s, reconciler 30 s, news, Lab jobs, Telegram long-poll.
- **Secrets:** Farjad sets them (`vercel env`, `flyctl secrets`); Claude never sees values. Check a Fly secret without printing it: `fly ssh console -a alphaboard-worker -C "node -e ..."` printing a character-class pattern. Never run `vercel deploy` / `vercel link` in `~/Developer/alphaboard` (it once overwrote `.env.local` with production credentials).
- **Telegram bots:** `TELEGRAM_BOT_TOKEN` = @AlphaBoardDeskBot (alerts, session room, long-polled by the worker). `SIGNAL_BOT_TOKEN` = @gheymattoday_bot (send-only channel posts; another service long-polls it, so never give it to the worker or you get `getUpdates: Conflict`).
- **Known limits:** Vercel's 4.5 MB request cap breaks Lab M1 CSV uploads above it (needs Vercel Blob). Rate limits live in `RateLimitBucket` since P13b.
- **Release checklist:** CI green on the PR → Farjad merges → Vercel builds (watch `/api/health` `version`) → if worker code changed, `flyctl deploy` → check Admin → System shows the tick running. Before any infra/migration change, run the production image test from `docs/ARCHITECTURE.md` § Verification.

## Decisions taken (2026-09-28)

- Default AI model → `gpt-5.4-mini` (built-in default; vision model stays `gpt-4o`). An admin value saved in Admin → AI still wins.
- Claude Opus 5 refusal fallbacks stay on; every fallback is recorded (`AiUsage.fallbackFrom`) and shown in Admin → AI (Fallbacks column, `requested → served` in By model).

## Worker (tick, sessions, Telegram)

- `lib/worker/index.ts` `startWorker()`: a lease row (`AppSetting worker.lease`, 45 s, renewed every 15 s) makes exactly one process the worker; another takes over when it expires. Heartbeat: `AppSetting worker.last`.
- `WORKER_MODE=inline` (default) → started by `instrumentation.ts` in the web process. `WORKER_MODE=separate` → the web process starts nothing; run `npm run worker` (Node with `--conditions=react-server` so `server-only` resolves, loads `.env` + `.env.local`). A bundled production worker image comes with P8b (ccxt).
- Loops: `runTick()` every 60 s (`TICK_DISABLED=1` turns only this off; `POST /api/cron/tick` still works), `monitorSessions()` every 15 s, Telegram `getUpdates` long-poll (25 s).
- `runTick()` in `lib/worker/tick.ts`: paper settlement (+ notifications) → equity snapshots → signal evaluation (P5) → price alerts (P6). Each part has its own try/catch.

## Exchange sessions (P8b/P8c)

- **Native stops (P8c) and targets (P14c):** `ccxtVenue` places a `stopLossPrice` market order after every entry when `features.<spot|swap.linear>.createOrder.stopLossPrice` is true, and on swap venues a `takeProfitPrice` order when `features.swap.linear.createOrder.takeProfitPrice` is true (spot keeps software targets). OANDA trades carry both `stopLossOnFill` and `takeProfitOnFill`; `setTakeProfit` edits or clears the trade's target. A resting stop is a `SessionOrder` (purpose STOP, type `stop_market`, status OPEN). `setStop` cancels and re-places it; `closePosition` cancels it first and, if it had already filled, books that fill instead of selling again; `syncStops` (monitor, every 15 s) books stops that fired. The software stop only acts 0.3% past a native stop (`NATIVE_STOP_SLACK`). Take-profit is still software. Testnet run 2026-09-29: the real AI opened BTC and ETH positions itself, the stop rested on Binance, the tightened stop was cancelled and re-placed, Binance filled it and the monitor booked it once, and kill cancelled the stop before selling.
- **Separate worker in production:** the image contains `worker.mjs`; Fly runs it as `node worker.mjs` with `WORKER_MODE=separate` on the web side (see § Production). Locally the inline worker stays the default.
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
- Keys: `FINNHUB_KEY`, `ALPHAVANTAGE_KEY`, `MARKETAUX_KEY` (free plans; set locally and in production), `NEWS_API_KEY`, optional `CRYPTOPANIC_KEY` + `CRYPTOPANIC_PLAN`.
- Yahoo per-symbol feeds are loose (mining stocks under gold), so they count as title-level relevance, not tags. Yahoo-syndicated items all share the publisher "Yahoo Finance".

## Agent sessions (P8a)

- Flow per cycle (`lib/sessions/cycle.ts`): triggers (interval, a close since the last cycle, ≥1.5% move; a quiet all-hold interval is skipped at most twice) → context block (`lib/sessions/desk/context.ts`, "unavailable" instead of guesses) → analysts (market + news, parallel) → optional debate → strategist (exit plan per entry) → `evaluateProposal` (`lib/risk/verdict.ts`) → paper venue (`lib/venues/paper.ts`, idempotent `clientOrderId`) → room messages.
- Monitor (`lib/sessions/monitor.ts`): stops/targets/liquidation on live prices, loss limit (realized + unrealized − fees) → HALTED + flatten, end → AWAITING_EXTENSION + prompt → timeout → `onEnd`; retries closes without a price; journals closed trades and writes the report in the background.
- AI prompts spell out their JSON shape (`SHAPES` in `lib/sessions/desk/prompts.ts`) because OpenAI runs in `json_object` mode; zod validates every answer. Per-role models via `AiRequest.model`.
- Agent failure → no trading that cycle, retry in 2 min; 3 in a row → PAUSED. AI budget reached → no more cycles, stops keep running.
- Limits: at most 3 active sessions per user; daily limits in `UserTradingLimits`; live mode refused until P8b.

## Telegram (optional)

1. Create a bot with @BotFather, put the token in `TELEGRAM_BOT_TOKEN` (never commit it).
2. Users link in Settings → Telegram: they send `/start CODE` (or tap the deep link); the worker links the chat within seconds.
3. Linked chats get `/sessions`, `/positions`, `/pause`, `/resume`, `/kill` and inline buttons (`TelegramAction` tokens: single use, 24 h, bound to the owner's chat; kill/close ask for confirmation). The end-of-session prompt is edited with the outcome.
4. Uses `getUpdates` long-polling from the single worker — do not also set a webhook on that bot (Telegram rejects getUpdates while a webhook is set).

## Signal Desk (P12)

**Pieces:**
- `lib/signalDesk/*`:
  - `validate` (form rules)
  - `wire` (EA protocol)
  - `state` (report → status, leg update, reply)
  - `format` (channel text)
  - `channel` (posting)
  - `service` (DB)
- `lib/signalDesk/devices.ts` (terminal tokens).
- EA routes `/api/mt5/{heartbeat,signals/next,signals/:id/report}`. They are public at the proxy and each one checks the bearer token.
- Admin routes `/api/signal-desk/*`.
- Page `/admin/signal-desk`.
- The tick calls `sweepSignals`.
- `mql5/SignalCopier.mq5`.

**Env:**
- `SIGNAL_BOT_TOKEN` and `SIGNAL_CHANNEL_ID`. With both empty, nothing is posted and execution still works.
- `SIGNAL_CHANNEL_USERNAME` is optional and only builds the "View in channel" links.
- The channel bot must be an admin of the channel. It is only used for `sendMessage`, so it can share a token with another service. Don't reuse `TELEGRAM_BOT_TOKEN`'s bot unless nothing else polls it.

**Setting up a terminal:**
1. Admin → Signals → New terminal. Copy the token; it is shown once.
2. MT5 → Tools → Options → Expert Advisors: allow WebRequest for the app's address.
3. Attach SignalCopier to one chart, with `InpBaseUrl` set to the app address and `InpToken` set to the token. Keep the defaults `InpDryRun=true` and `InpAllowReal=false`. Algo Trading must be on.
4. The terminal card shows the account and "online" within 30 s.
5. Compile with the Wine MetaEditor CLI (see memory / P11c). The source in the repo is the copy of record.

**Status meanings:**
- PENDING: waiting for a terminal; expires after 10 min.
- SENT: a terminal took it.
- OPEN: at least one position is filled.
- CLOSED: every position is closed, or it was a dry run or channel only.
- REJECTED: refused by the EA or the broker, with the reason.
- **UNKNOWN**: a terminal took it but reported nothing within 2 min. Look in MT5 to see whether positions with comment `ab:<id>:<n>` exist. Nothing is retried. A late FILLED report brings the signal back to OPEN.

**Management (1.13, P14d):** after TP1 the other legs go to entry + `InpBEBufferPts` points; after TP2 they go to the TP1 price (`InpStepUpAfterTP2`); `InpTrailAtr` > 0 trails at N × ATR(14, `InpTrailTf`) once the stop is at or beyond the entry (`InpTrailAfterBE`), moving by at least `InpTrailStepAtr` × ATR; trailing is local (no channel post). Commands from the page: Stop to entry, Move stop… (`MOVE_SL|price`), Move target… (`MOVE_TP|leg|price`), Close part… (`CLOSE_PARTIAL|fraction`), Close all. The expert refuses a stop on the wrong side of the market, one that loosens, or one inside the broker's stops level, and logs why. Reports: `BE`/`SL_MOVED` (price), `TP_MOVED` (leg, price), `PARTIAL` (leg, price, volume, left).

**Money management in the expert** (1.10; whole account, broker day, like GoldHedgeManager):
- `InpDailyLossPct` 2: closed P/L today plus the floating P/L of positions opened today.
- `InpMaxConsecLoss` 2: the legs of one signal count as one trade.
- `InpCooldownMin` 30.
- `InpMaxOpenSignals` 2.

A blocked signal is REJECTED, and the guard's reason appears in the list.

**Going live (decided 2026-10-21: no demo; a dry run on the real account instead). Each step that touches real money is Farjad's, never Claude's:**
1. Merge the PR and set the `SIGNAL_*` vars on Vercel (done 2026-10-22).
2. Attach the expert on the real account with `InpAllowReal=true` and `InpDryRun=true`.
3. Send 2–3 signals with "Post to channel" unticked. Check the DRY_RUN lines (lots, legs, stop, TPs) against the risk by hand.
4. Farjad sets `InpDryRun=false`. First signal: gold, 0.5 % risk; Claude watches the reports.

GoldHedgeManager (magic 880801) does not touch copier positions (magic 880900). Its daily loss lock does not stop the copier either; the copier has its own caps.

