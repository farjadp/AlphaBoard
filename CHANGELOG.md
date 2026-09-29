# Changelog

All notable changes to AlphaBoard are documented here.

## [Unreleased]

### P8a · Agent trading sessions (paper)
- **Sessions:** start a time-boxed session under a mandate — symbols (any catalog asset), spot or perpetual with a leverage cap, capital, risk per trade, max position, max open positions, max trades, loss limit, cooldown after a stop, decision interval, what happens at the end, per-role AI models, an AI budget. The mandate is frozen once the session starts.
- **Desk room:** market and news analysts, an optional bull/bear debate, and a strategist whose every entry carries an exit plan (stop, target, invalidation, horizon) that is re-read on every later cycle. Everything — including the risk engine's reasons and each fill — is posted in a live room.
- **Risk engine (code, not AI):** sizes from the stop distance and risk per trade; clamps to the position cap and free capital (after fees); refuses shorts on spot, stops beyond liquidation, targets too close to pay fees, trades past the limits or during a cooldown, and new entries in the last minutes. Exits are never blocked.
- **Enforcement every 15 s:** software stops, targets and liquidation on live prices; the session loss limit (realized + unrealized − fees) halts and flattens; at the end a prompt (web + Telegram) waits 5 minutes, then closes everything or keeps positions with their stops.
- **Telegram controls:** `/sessions`, `/positions`, `/pause`, `/resume`, `/kill`; inline buttons to close, close 50% or move a stop to breakeven, with confirmation for destructive actions; single-use, chat-bound buttons.
- **Journal and report:** every closed session trade becomes a Journal entry with an AI lesson; each session ends with metrics computed in code (net of fees and AI cost, win rate, expectancy in R, drawdown, rejections, buy-and-hold) plus a written summary.
- **Daily limits** across sessions (max daily loss, max sessions per day); at most 3 sessions at once.
- **Worker:** background work moved from the ad-hoc scheduler to a leased worker (`lib/worker`), inline by default or separate with `WORKER_MODE=separate` + `npm run worker`; Telegram now long-polls instead of polling once a minute.

## [2.0.1] — 2026-09-29

Deployment fixes found by building and booting the production Docker image against an empty database before the first Railway deploy.

- **Admin bootstrap works in the container:** the seed is now plain JavaScript (`prisma/seed.mjs`) run with `node`, and `bcryptjs` is copied into the image. Before, `prisma db seed` needed `tsx`, which the image does not ship, so the first admin was never created (the failure was logged as non-fatal).
- `robots.txt` and `sitemap.xml` are generated per request, so they use the runtime `APP_URL` instead of the build-time fallback (`localhost`).
- The Docker `HEALTHCHECK` uses `$PORT` (Railway runs on 8080).

## [2.0.0] — 2026-09-29

AlphaBoard v2 turns the single-browser dashboard into an invite-only, multi-user trading-intelligence workspace: every user's data in PostgreSQL, four AI providers with cost control, paper trading, AI signals graded against the market, server-side alerts, a new light interface, and a public landing page. No live order execution — analysis and paper trading only.

Quality at release: 216 tests (unit + Postgres), TypeScript and ESLint clean, axe-core WCAG 2.1/2.2 AA scan with 0 violations on 22 page views, impeccable technical audit 19/20.

### P7 · Interface & release
- **New light "briefing" interface:** Tailwind v4 design tokens, Manrope / JetBrains Mono / Bricolage Grotesque, decision-first market screen (trade ticket before evidence), ⌘K symbol search, 24-hour session band, timeframe agreement row.
- **Risk disclaimer:** users accept it once before using the app (enforced for pages and APIs in `proxy.ts`, recorded with an audit entry); `/legal` page; a one-line risk notice on every page.
- **Public landing page** at `/` with a real product screenshot, the "read → decide → practise → measure" loop, and a **waitlist** that admins turn into invites from Admin → Invites.
- **SEO:** metadata and Open Graph/Twitter cards, `robots.txt`, `sitemap.xml`, an OG image cut from the real market screen, JSON-LD.
- **Admin → System:** plain-language status, scheduler health strip (last 120 runs), people, workload, 7-day AI usage and **recent server errors** (API 5xx, render errors, scheduler failures; repeats counted, kept 14 days).
- **Track record on the trade ticket:** your graded results for that symbol and timeframe; plans that have already played out are marked as such instead of looking live.
- **Accessibility:** AA contrast for every text colour, labelled form controls, keyboard-operable upload areas and scroll regions, landmarks and heading order, 24px minimum targets, a reduced-motion mode that keeps loading visible.
- Validation errors now answer 400 with the failing field instead of 500; unused dependencies (`axios`, `ws`, `@hello-pangea/dnd`) removed.

### P6 · Alerts & notifications
- **Price alerts run on the server** every minute against 5-minute candle highs/lows and the live quote, even with no tab open; each fires once and records the price it saw.
- **Notification centre** (bell in the header) for price alerts and paper positions closed by stop, target or liquidation.
- **Telegram (optional):** with `TELEGRAM_BOT_TOKEN`, users link a chat from Settings with a one-time `/start` code; `/stop` unlinks; a blocked bot unlinks automatically.

### P5 · Signal evaluation
- Every BUY/SELL signal is **replayed on the candles of its own timeframe**: target hit, stopped out, expired, or entry never reached — scored in R (1R = entry-to-stop distance), no fees.
- Conservative rules: pre-signal candles ignored, stop wins when stop and target share a candle, gaps through the stop exit at the open, only the stop counts on the fill candle.
- **Performance page:** win rate, expectancy, profit factor, total R, max drawdown, cumulative-R curve, confidence calibration, and breakdowns by AI model, asset, timeframe and confidence — with URL filters. Archive cards show each outcome.

### P4 · Paper trading
- **Paper account** (10,000 USDT, resettable), isolated margin, leverage 1–20×, liquidation price; fills at the live price with 0.05% slippage and a 0.05% fee per side.
- Stops and targets checked **every 60 seconds on the server** against candle highs/lows (scheduler in `instrumentation.ts`, external trigger `POST /api/cron/tick`).
- Equity curve, positions and history, edit stop/target, **"Trade on paper" from any signal**.
- AI: default model switched to `gpt-5.4-mini` (faster and cheaper than `gpt-4o` in a live test); Claude Opus 5 refusals answered by a fallback model are recorded and shown in Admin → AI.

### P3 · AI providers (2026-09-28)
- **Four providers behind one entry point** (`lib/ai`): OpenAI, Anthropic (official TypeScript SDK, structured outputs, server-side refusal fallbacks on Claude Opus 5), OpenRouter (records the provider-reported cost) and DeepSeek.
- **Model catalog with verified list prices**; reasoning models get the right request parameters (no temperature, room for reasoning tokens); image features automatically move to an image-capable model.
- **Usage accounting:** every call is logged with tokens, estimated cost, latency and outcome — including failed calls and answers that failed validation.
- **Daily token allowance per user** (resets 00:00 UTC), checked before any tokens are spent.
- **Settings page** (choose your model, see today's usage) and **Admin → AI** (default and image models, default allowance, 7-day usage by user/model/feature/day) and **Admin → Users** (per-user allowance).
- Each strategy report shows which model produced it, its tokens and estimated cost; the archive records the actual model.

### P2 · Persistence (2026-09-28)
- **Your data lives in your account:** journal, post-mortem lessons, AI signal archive, chart-academy studies, price alerts and watchlist moved from browser localStorage to PostgreSQL, scoped per user.
- **Screenshots** are stored as compressed attachments and served only to their owner.
- **Import browser data** (`/import`, also linked from a dashboard banner): previews what is found, compresses and uploads images, and imports idempotently (running it twice adds nothing; a later run can attach images that failed earlier).
- **AI strategy reports** are archived on the server at generation time, with the exact price the model saw; the prompt now reads the trader's own lessons from the database instead of accepting them from the client.
- **Account menu**: sign out (clears all cached data), import, admin link. Data refreshes when you return to the tab.
- **Tests:** 84 (including Postgres-backed isolation tests proving one user cannot read, change, or reference another user's data).

### P1 · Data integrity (2026-09-28)
- Server-side market-data layer with caching; real intraday candles for indices, commodities and FX; trend and stretch scored separately.
- Removed every fabricated value (mock prices, fixed long/short panel, fake news, mock AI output); real funding, open interest and long/short ratio.
- Validated AI output for all AI routes; images accepted only as size-capped inline data.
- Fixed WebSocket leak, alert bugs, journal upload hang, PnL on zero entry; ESLint rules re-enabled.

### P0 · Foundation (2026-09-27)
- **Security:** invite-only registration, `requireUser()`/`requireAdmin()` data-access layer, every API route authenticated and rate-limited, strict security headers, capped request bodies.
- **Ops:** PostgreSQL migrations (`prisma migrate`, no more `db push`), admin bootstrap seed, `/api/health`, pino JSON logging with request ids, error/404 pages.
- **Delivery:** Dockerfile (non-root, standalone), docker-compose, GitHub Actions CI (typecheck, lint, test, build), Vitest.
- **Removed:** unfinished `/portal` skeleton and root test scripts.

## [1.x] — 2026-05-09 (v1, single-browser dashboard)

### Added
- **Institutional-Grade AI Engine**: Upgraded signal generation prompt to strictly enforce `temperature: 0` determinism using `gpt-4o`, preventing conflicting signal generation (Signal Flipping).
- **Advanced Technical Levels**: The AI now extracts and outputs up to 3 Support and Resistance levels for every analysis.
- **Safe Entry Zones**: Added capability to identify 1 to 3 "Safe Entry" zones based on technical structures, aiding in execution patience.
- **HOLD Enforcement**: The AI is now explicitly trained to select `HOLD` during high-volatility, low-probability, or ranging markets, prioritizing capital preservation over forced trades.
- **Full Asset Support**: Connected the backend Indicators API directly to the comprehensive `ASSET_CATALOG`, unlocking AI Analysis for all 60+ assets (Crypto, TradFi, Indices, Commodities, and Forex) available in the Setup page.

### Fixed
- **Random/Unstable AI Output**: Addressed issue where the AI would provide conflicting bias within short timeframes by heavily modifying the prompt logic and enforcing deterministic outputs.
- **Yahoo Finance Integration (TradFi/Commodities)**: Fixed API crash for XAU/USD and other TradFi assets by migrating from the deprecated `historical` endpoint to the `chart` endpoint in `yahoo-finance2`.
- **Missing Crypto Pairs**: Resolved backend parsing errors by adding `SOL/USDT` and `XRP/USDT` to the core database loop.
- **Syntax Errors**: Fixed build errors in server actions caused by unescaped complex template literals during prompt processing.
