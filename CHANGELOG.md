# Changelog

All notable changes to AlphaBoard are documented here.

## [Unreleased]

### Stops and targets in percent
- Paper order ticket, paper position editor and session position editor have a **Price / %** switch for stop-loss and take-profit. A percent is a distance from the estimated fill (new order) or the entry price (open position), on the losing side for a stop and the winning side for a target; the price it means is shown underneath. Switching converts the values both ways, and a percent left as converted keeps the exact current level.

### P17 · Sessions: Balanced entry style
- **New "Entry style" per session:** Balanced (the form default) or Conservative (the rules so far; also what stored sessions and API calls without the field keep).
- **Balanced:** opens at 60% conviction; the market analyst only has to not read the opposite way at 60%+ (neutral is fine); a 1H pullback inside the 4H trend is a valid setup; every entry needs a take-profit at 1.5R or more; the strategist runs when any market note is directional at 50%+; the form presets "stop after losses in a row" to 3.
- **Unchanged in both:** risk per trade, position cap, stop at ≥ 1.5× the 1H ATR, no entries against the 4H trend, session / daily loss limits, cooldowns, exit management. Size for the same stop is identical.
- Refused entries now keep their price, stop, target, horizon and profile in the verdict message, so a later study can replay what they would have done.

### P16 · Menus
- Masthead: Markets · Trade (Paper, Sessions, Alerts) · Review (Performance, Journal, Archive) · Learn, with the section's pages in a strip underneath; theme switch moved into the account menu; on phones the symbol search is a magnifier that opens across the masthead.

### P15 · New look ("Forecast Verification Bulletin") + live chart
- **New visual world, light and dark:** every plan reads like a forecast bulletin, issued with a UTC timestamp and a valid-until stamp, then verified. Chart-paper light theme and a radar-night dark theme with a switch in the masthead (remembered per browser, follows the OS until pinned, no flash on load). New faces (Public Sans, JetBrains Mono for figures), square-cut sheets with a heavy top rule, faint isobar contours behind the app, isobar-blue band on the plan ticket, a UTC clock in the masthead. All text pairs ≥ 4.5:1 in both themes.
- **Live chart:** the AlphaBoard chart now updates the forming candle on every trade from Binance's kline stream (crypto), shows volume, and has EMA 20 / EMA 50 toggles; the plan's entry, stop and target lines stay on it. Candles carry volume from Binance and Yahoo.
- **TradingView tab:** TradingView's free Advanced Real-Time Chart widget (their data, drawing tools and indicators) sits beside our chart for every market with a free TradingView feed; it follows the theme. Their Advanced Charts library was ruled out: its free licence covers public sites only, and AlphaBoard is invite-only.
- Market header shows 24h high / low / volume as a readings row; direction marks are drawn SVG instead of text glyphs.

### P13c · Folders settled (no behaviour change)
- Loose `lib/` root files moved into features (`market/catalog`, `market/patterns/`, `config/site`, `db/client`; `lib/binance.ts` removed); execution code in `venues/` (connections, reconciler); MT5 device code in `signalDesk/`, deal import in `lab/data/`; `alerts/store`, `worker/tick`, `sessions/desk/` (agents); the legacy v1 import in one `lib/import/`.
- `lib/signals` → `lib/signalDesk` ("signals" also meant archived AI analyses); API paths unchanged.
- Shared types live with their feature; hooks under `lib/client/hooks/`; no loose files at the `components/` root.
- Pages and routes no longer query Prisma: 18 of them now call lib services, and ESLint rejects `@/lib/db/client` in `app/**` and `components/**`.

### P14c · Sessions: native targets, trailing, honest monitor
- **Targets rest at the broker:** OANDA trades carry `takeProfitOnFill`, and moving or clearing the target edits the trade; swap exchanges that support a take-profit trigger get a reduce-only take-profit order next to the stop. The software monitor gives a resting target the same room it gives a resting stop. Spot exchanges keep software targets (two resting sells would lock the balance twice).
- **A position reduced in OANDA's own app** is now booked as a partial close instead of being ignored, and the final close books only what was left.
- **Trailing stop per position:** set an ATR multiple in the room (Stop / target / trail…); the monitor trails the stop at that distance behind the 1H ATR, tightening only, and posts each move.
- **Monitor says when it is blind:** three checks without a price post one alert in the room instead of a silent skip; failures to restore an exchange stop or target after a close, and reconciler calls that fail, are recorded in Admin → System instead of being swallowed.
- **Room:** edit stop / target / trailing in place, close any percentage (Close part…), breakeven uses the shared rule.

### P14a · One position core (paper + agent sessions)
- `lib/trading/positions`: exits over candles or a spot price (liquidation, stop, target), MFE/MAE and R against the **initial** stop, and management rules (breakeven with a buffer, ATR trailing, manual levels that only tighten, take-profit ladders). Pure, tested, used by both worlds.
- **Agent sessions:** the 15-second monitor now also scans the 5-minute candles since its last check, so a wick between two polls no longer slips through; a moved stop resets that window. Positions show **R now** and best/worst excursion in the room; `/api/sessions/positions/[id]` takes `set_exits` (stop and/or target, stop only tightening) and any close `fraction`.
- **Paper trading:** positions record the stop at entry and best/worst price from candle ranges; open and closed tables show R. (Partial close, trailing and ladders in the paper UI come with P14b.)
- Migration `20261031150000_p14a_position_tracking`.

### P14d · SignalCopier 1.13 + Signal Desk commands
- **New commands from Admin → Signals** on an open signal: *Move stop…* (`MOVE_SL`, tightening only, checked on the server against the signal's stop and the open targets, and again by the expert against the market), *Move target…* (`MOVE_TP`, one leg), *Close part…* (`CLOSE_PARTIAL`, a fraction of every open leg). One command waits at a time.
- **Expert 1.13:** breakeven can sit a few points past the entry (`InpBEBufferPts`, covers spread and commission); after TP2 the remaining legs' stop moves to the TP1 price (`InpStepUpAfterTP2`); optional ATR trailing (`InpTrailAtr` × ATR on `InpTrailTf`, by default only once the stop is at or beyond the entry; trailing steps are local and not posted); `BE` reports carry the real level; new reports `SL_MOVED`, `TP_MOVED`, `PARTIAL` (volume closed and volume left) are posted as replies under the signal.
- The expert compiles with 0 errors and 0 warnings; it has not been attached to a terminal yet.

### P13b · Shared foundations (no behaviour change, one new table)
- `lib/trading/math.ts`: one definition of direction, R-multiple, gross P&L and stop/target side rules, used by paper trading, sessions, the signal evaluator, the Signal Desk and the Lab.
- `lib/format/`: one number/money/date module replaces about twenty local helpers; a true minus sign and "Unavailable" for missing values everywhere.
- `lib/market/symbols.ts` (broker suffixes, aliases, USD/USDT) and one Binance host failover (`binanceJson`).
- `lib/env.ts`: every server environment read goes through one validated module; flags are on only when set to `1`.
- Routes: `adminRoute()` and `deviceRoute()` wrappers (nine admin routes gained the rate limit they were missing), size-capped JSON on the Signal Desk routes, an `audit()` helper.
- **Rate limits are shared through Postgres** (`RateLimitBucket`, migration `20261031120000`), so they hold across Vercel instances; the per-instance bucket remains as a 30-second fallback when the database is unreachable.
- Two Postgres tests no longer fail on weekends (they pin a weekday clock).

### P12 · Signal Desk (admin)
- **Admin → Signals:** write a trade once (symbol, long/short, entry or market, a mandatory stop, up to four targets, risk % of balance up to 1 %, an optional note). It is posted to your Telegram channel and executed in MetaTrader 5 by the new `SignalCopier` expert. The form checks every rule while you type and shows the exact channel post before you send it.
- **Channel posts** go out through a separate bot (`SIGNAL_BOT_TOKEN`, `SIGNAL_CHANNEL_ID`; it only sends, never polls). Targets, stops and closes are posted as replies under the signal, with the result in R. Account money never appears. Execution never waits on Telegram: a failed post is shown on the signal.
- **`mql5/SignalCopier.mq5`** polls AlphaBoard every 3 s with its own terminal token (created and revoked in the page, shown once, stored hashed). It opens one position per target, all with the same stop and their own take-profit at the broker, and sizes them from the risk without ever rounding up to the minimum lot. After TP1 the other positions move to entry. Fills, targets, stops and closes are reported back, and a failed report is retried.
- **Safety:** each signal is handed to a terminal at most once and never re-sent. A signal that no terminal takes within 10 minutes expires. If the terminal goes silent for 2 minutes after taking a signal, the signal is marked "No word from MT5" and you get one alert to check the terminal. The expert starts in dry run and refuses a real-money account unless allowed. It stops taking signals while Algo Trading is off, and it never opens the same position twice. From the list: Cancel (before the terminal takes it), Stop to entry, Close all.
- **Money management in the expert** (whole account, broker day, same rules as GoldHedgeManager):
  - daily loss lock at 2 % of the day's starting balance;
  - no new signals after 2 losing trades in a row;
  - a 30-minute pause after any loss;
  - at most 2 signals open at once.

  All the positions of one signal count as one trade. A blocked signal shows the reason in the list.
- **Paste a signal:** you can paste a post's text, paste or drop a screenshot from another channel, and AI fills the form. It reads the symbol, side, entry or entry zone, stop and targets, and matches the symbol to your terminal's (`GOLD`/`XAU/USD` → `XAUUSD.ec`, `ETH/USDT` → `ETHUSD.ec`). An entry zone becomes its middle, and the terminal accepts a fill anywhere in the zone. Targets on the wrong side are dropped and at most 4 are kept. A missing stop is flagged, never invented. Every decision is listed above the form. Nothing is sent until you press Send.
- **Suggest stop & targets:** when a post gives only a symbol and a side, the desk reads the last two days of 1H candles. It places the stop past the swing with a 0.25 ATR buffer, kept between 1.5 and 3 ATR, and sets four targets on Fibonacci extensions (0.618 / 1 / 1.272 / 1.618) of that swing. After a paste it runs on its own and fills only the missing fields; the button recomputes both. Levels are distances placed around the typed entry, because gold and silver data are futures and trade away from broker spot (the form says so).
- **Channel post template:** Admin → Signals has a template editor with field buttons (`{symbol}`, `{entry}`, `{stop}`, `{targets}`, `{rr}`, `{note}`, `{channel}`, …) and a live preview. A line whose fields are all empty is left out. The default matches the channel's existing posts (Entry / Risk / Stop-Loss / TARGETS with 🎯 lines and the Persian footer). Templates missing the symbol, side or stop are refused.
- **Market entry for post-only signals:** a blank entry is filled with the live price when the post is sent (Binance for crypto). Gold and silver ask for the broker price, because their feed is futures.
- **Source:** an optional field for where the idea came from. It is shown in the list and never posted, so results can later be compared by source. 1 migration (`TradeSignal.source`).
- Plan: `docs/archive/plans/2026-10-21-p12-signal-desk.md`. 2 migrations (`Mt5Device`, `TradeSignal`, `TradeSignalLeg`; `TradeSignal.breakevenAt`).

### P11a · Money-management guards and an honest drawdown
- **Stop after losses in a row:** a session refuses new entries for the rest of the UTC day after `maxConsecLosses` losing trades in a row (default 2, 0 = off). A winning or breakeven close resets the count.
- **Pause after any loss:** no new entry on any symbol for `lossCooldownMin` minutes after a losing close (default 30, 0 = off). The existing per-symbol cooldown after a stop-out stays.
- Exits are never blocked. The strategist sees the streak and is told when entries are closed, so it holds instead of proposing trades the risk engine will refuse. Both settings are in the mandate form and in the room's mandate box. Sessions started before this change keep both guards off.
- **Drawdown with open positions included:** the monitor records the equity peak and the deepest fall from it every pass (`TradingSession.equityPeak`, `maxDrawdownMtm`). The report leads with that figure, keeps the closed-trades-only figure next to it, and says so when most of the fall happened in positions that were still open. Until now the report counted closed trades only, which hides losses a strategy never closes.
- Background: the 2026-10-20 research (plan `docs/archive/plans/2026-10-20-p11-honest-numbers-and-strategy-lab.md`).

### P11b · Strategy Lab (admin)
- **Admin → Lab:** test a trading rule and its money management on real past prices before real money touches it. Every figure counts open positions, includes costs, and shows how much of the result is luck (random re-runs on half the entries).
- **Data:** one-minute bars from OANDA (bid and ask, so the spread is the broker's real one; read-only use of your connection), from Binance, or a broker's own MT5 export (`ExportM1.mq5` script, up to ~60 MB).
- **Study:** the gold expert's set (one position with a stop, or two positions with the second one candle against), entries at every allowed 15-minute candle, direction with the 4-hour trend / both / long / short, and money rules (risk %, trades open at once with the risk split, daily loss lock, stop after losses in a row, pause after a loss, martingale as the warning case). The result leads with plain sentences, then the numbers, the re-run range, the balance curve and returns by year.
- **Crypto basket · DCA ladder:** build a survivorship-free basket of Binance USD-M coins (every symbol listed at a chosen month, delisted ones included, from the public monthly archive) and test the long-only DCA ladder ("Robi" family). The chart puts the real account value next to the closed-trades-only curve a profit calendar shows.
- **Your trades (MT5):** `mql5/ExportDeals.mq5` exports the deal history; the Lab imports closed positions (journal rows too) and checks whether the entries beat random entries with the same side, stop and holding time (bootstrap 95 % interval, from 30 trades).
- **Engine (`lib/lab`)** is pure TypeScript and reproduces the 2026-10-20 research: gold return-to-entry 37.4 %, the money-management run +24.9 % on 523 trades, and the "Robi" DCA replay on 129 Binance symbols (10,381 episodes, 94.5 % drawdown marked to market vs 3.3 % realized). 

## [2.1.0] — 2026-09-29

Agent trading sessions: a mandate-driven AI desk that trades on paper, on crypto exchanges through ccxt (with stop orders resting on the exchange), or on OANDA for forex, gold and silver — with a rule-based risk engine, a live room, Telegram controls, journal lessons and session reports. Also: the news hub.

### P9 · Forex, gold and silver via OANDA
- **OANDA connections** in Settings: practice or live, v20 account id and API token (encrypted), account currency.
- **Sessions on OANDA** trade forex and metals as margin CFDs, long or short, sized in units, with leverage capped by OANDA's margin rate for each instrument. Only instruments quoted in the account currency are offered (XAU/USD, EUR/USD on a USD account).
- **Entry and stop are one atomic order** (stop-loss attached on fill, at the broker). Moving a stop edits it at OANDA. Stops, targets and margin closeouts that happen at OANDA are detected and booked with OANDA's own P&L, commission and financing.
- **Safety:** orders carry our client id, so an unclear outcome is looked up and never re-sent. New trades never net against another trade (`OPEN_ONLY`). A reconciler compares OANDA's open trades with the ledger every 30 s.
- While every session market is closed (FX weekend, metals break), cycles skip the AI call.

### P8c · Native exchange stops
- **Stop-loss orders on the exchange** where ccxt supports them (Binance, Bybit, OKX, Coinbase): placed right after each entry for the quantity actually held, replaced when the strategist or you move the stop, cancelled before any market close, left in place with "keep with stops" at the end. A stop that fires on the exchange is booked from the exchange's fill, once. Other venues keep software stops, and the room says which mode a session uses.
- The software stop remains as a fallback, acting 0.3% beyond an exchange-held stop.
- **Bundled worker:** `npm run build:worker` → `dist/worker.mjs`; the Docker image ships it as `worker.mjs` for a separate worker service.

### News hub
- **Many sources at once:** Finnhub, Alpha Vantage, Marketaux, NewsAPI, CoinDesk / Cointelegraph / Decrypt RSS, Yahoo and (paid) CryptoPanic v2. Each source keeps its own interval and a daily budget below its free limit; per-symbol sources rotate through watchlists and running sessions.
- **De-duplication and symbols:** the same article from two sources is merged (canonical URL, then title within 48 h); symbols are found from names and tickers in the headline or summary, plus the providers' own tags.
- **Weighted headlines:** publisher credibility × recency × relevance × confirmation by other publishers. The market news panel and the agents' news analyst get the top headlines from all sources with the publisher and how the sentiment was obtained (provider score, reader votes or keyword guess).
- **Publisher weights by an agent, weekly:** it reads each publisher's measured accuracy (price move 4 h / 24 h after its headlines) and proposes weights with reasons; the code applies them within 0.1–1.0, at most ±0.2 a week, only with ≥ 20 evaluated calls. Every change is logged with the numbers; admins can override or revert (Admin → News).
- **News index (shadow):** hourly weighted sentiment per symbol, evaluated against later returns. It is recorded only and not given to trading agents.
- Fixed: hidden accessibility labels made long pages taller than the screen, so keyboard focus could scroll the window into a blank area.

### P8b · Exchange execution (ccxt)
- **Exchange connections** in Settings (owner only, with `LIVE_TRADING_ENABLED=1` and `EXCHANGE_KEY_SECRET`): any ccxt exchange, spot or perpetual, a quote currency, testnet or real money. Keys are AES-256-GCM encrypted; only the last four characters are shown; "Test" loads markets and reads the balance.
- **Sessions on an exchange:** pick a tested connection in the mandate form. Real-money sessions need the typed confirmation `LIVE`. Start checks the market type, that every symbol is listed, and that the capital fits the free quote balance.
- **Safe execution:** market orders with a deterministic client id written to the database before sending; a timeout is resolved by looking the order up (never re-sent); an order that stays unknown halts the session. Fills, fees (including fees paid in the base asset) and P&L come from the exchange.
- **Reconciler every 30 s:** our own orders left open are cancelled, stale orders are resolved, and spot balances / perpetual positions must match the ledger — any mismatch halts the session and closes what it holds.
- **`TRADING_HALT=1`** refuses new entries everywhere; exits still run. Stops are software stops on the exchange price, checked every 15 s.

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
