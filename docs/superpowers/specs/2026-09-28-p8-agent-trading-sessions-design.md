# AlphaBoard P8 — Agent Trading Sessions — Design Spec

Date: 2026-09-28
Status: DRAFT — awaiting approval
Author: Claude (with Farjad P.D)
Research: `docs/superpowers/research/2026-09-28-p8-agents-exchanges.md`

## 1. Goal

Let a user start a time-boxed **Trading Session**: they set a mandate (capital, duration, loss limit, risk model, allowed symbols, leverage), a small team of LLM agents discusses the market in a visible chat room and proposes trades, a deterministic risk engine approves/clamps/vetoes them, an executor places them on paper or on a real exchange, and a journal agent writes per-trade notes and an end-of-session report. The user watches and intervenes from the web app and from Telegram.

This reverses v2 non-goal "no live execution". AlphaBoard is open-source and self-hosted: each deployment's owner uses their own exchange keys and carries their own risk. The software enforces the limits the user sets; it does not impose extra product limits (spot-only, venue allowlists) beyond them.

Success for P8 is **correctness and auditability**, not profit: every order the system places is intended, sized per mandate, reconciled with the exchange, explained in the chat room, and stoppable within seconds.

## 2. Decisions (locked unless noted)

| # | Decision | Rationale |
|---|---|---|
| E1 | Unit of work is a **Session** with a **Mandate**; nothing trades outside a running session | Every trade has bounded scope, time and loss |
| E2 | Mandate limits are enforced in code by the risk engine, never only in prompts. The LLM proposes; code decides size and whether to trade | Research: LLM risk control fails (overtrading, leverage, random flips) |
| E3 | Exits (SL/TP, loss limit, kill, session end) never wait for an LLM | Borrowed from QuantDinger |
| E4 | Execution goes through one `Venue` interface: `paper`, `ccxt` (P8), `oanda` (P9), `mt5` bridge (P9, optional). Session engine is venue-agnostic | Forex/metals added later as an adapter only |
| E5 | `ccxt` venue supports **spot and perpetual swaps**, any exchange ccxt supports, sandbox/testnet when the exchange has one. Leverage and margin mode come from the mandate | Farjad: do not restrict; users choose their own risk |
| E6 | Live trading requires all of: env `LIVE_TRADING_ENABLED=1`, user role `ADMIN` (the deployment owner), a verified exchange connection, and a typed confirmation ("LIVE") when starting a live session. Default everywhere is paper | Safe defaults for an open-source repo |
| E7 | Exchange API keys are stored encrypted (AES-256-GCM, master key `EXCHANGE_KEY_SECRET` env, key version stored). No key → live features disabled (fail closed). Keys are decrypted only in the worker and never logged or sent to the client (only last 4 chars) | Secrets hygiene |
| E8 | A separate **worker process** (same image, `node dist/worker.js`) runs the session engine, executor, reconciler, price watcher, the existing 60s tick, and Telegram long-polling. The web process no longer runs the tick | Long-lived loops and ccxt do not belong in route handlers; Telegram buttons need near-instant polling; avoids ccxt in the Next bundle |
| E9 | Every agent message, risk decision, order and fill is persisted and shown in the session **chat room** | Trust comes from seeing why |
| E10 | Session end: at `endsAt` the session stops opening trades and sends a Telegram prompt (Extend +N h / Close all / Keep with stops). No answer within `extensionTimeoutMin` (default 5) → the session ends with the mandate's `onEnd` action (default `CLOSE_ALL`) | Farjad's rule: no answer in 5 minutes → cancel |
| E11 | Session loss limit hit → immediate HALT: cancel open orders, close all positions at market, notify. Not overridable mid-session | Hard stop |
| E12 | Telegram is interactive: list positions with live P&L, close / close 50% / move SL to breakeven, pause / resume, kill (with confirm), session status. Same controls in the web room | Farjad: must see and manage open positions |
| E13 | Agents: Market Analyst, News Analyst, optional Bull/Bear (one round, off by default), Strategist, Journal. Risk Officer and Executor are code but speak in the room | Research: borrow TradingAgents roles, skip LLM risk debate and multi-round debates |
| E14 | Strategist output carries an **exit plan** (TP, SL, invalidation condition, horizon) that is persisted and re-injected on every later cycle for that position | Alpha Arena's most useful idea |
| E15 | Numbers never come from the LLM: prices, indicators, balances, sizes and P&L come from `lib/market` / the venue; the LLM's SL/TP are validated against the live price and clamped | FinRobot rule; avoids hallucinated prices |
| E16 | Decision cadence is a mandate field (default 30 min) plus event triggers (price alert hit, position near SL/TP, invalidation check). The loop skips the LLM when nothing material changed | Cost and overtrading control |
| E17 | Per-session LLM cost cap (`maxLlmCostUsd`); LLM cost is shown next to P&L everywhere | On small capital, LLM cost can exceed P&L |
| E18 | Closed session trades are written to the existing Journal (`JournalEntry`, `pnlSource = SESSION`) with a Journal-agent `TradeLesson`; top-k recent lessons are injected into the Strategist | Reuse P2/P3 journal; reflection-lite |
| E19 | Account-level **daily limits** (max daily loss, max sessions per day) apply across all sessions of the user | "What is today's allowed limit" |
| E20 | Multi-model arena is not in P8 (models are per-role settings); revisit after P8b | Scope |

## 3. Mandate

| Field | Type / default | Enforced by |
|---|---|---|
| `venue` | `paper` or an `ExchangeConnection` id | engine |
| `marketType` | `spot` \| `swap` | executor |
| `symbols` | allowlist, 1–10 (e.g. BTC/USDT, ETH/USDT) | risk |
| `capital` | quote-currency amount the session may use (≤ free balance at start) | risk |
| `maxLeverage` | 1 (spot forces 1) | risk |
| `marginMode` | `isolated` (swap only) | executor |
| `riskPerTradePct` | 1% of session capital | risk (sizing) |
| `maxPositionPct` | 50% of capital per position (notional/leverage) | risk |
| `maxOpenPositions` | 2 | risk |
| `maxTrades` | 6 per session | risk |
| `lossLimit` | amount in quote currency (e.g. 10% of capital), measured on session equity change = realized + unrealized − fees, checked every 15 s | engine → HALT |
| `durationMin` | 480 | engine |
| `decisionIntervalMin` | 30 (min 5) | scheduler |
| `cooldownMin` | 30 after a stop-loss on the same symbol | risk |
| `onEnd` | `CLOSE_ALL` \| `KEEP_WITH_STOPS` | engine |
| `extensionTimeoutMin` | 5 | engine |
| `orderStyle` | `market` \| `limit_post_only` (fallback to market after `limitTimeoutSec`, default 60) | executor |
| `models` | per role: analysts (cheap), strategist, journal; defaults from admin AI settings | agents |
| `debate` | false | agents |
| `maxLlmCostUsd` | 1.00 | engine → pause LLM, keep managing exits |

Validation: zod schema shared by UI and API; mandate is frozen once the session starts (extensions only change `endsAt`).

## 4. Architecture

```
lib/
  sessions/
    mandate.ts        zod schema, defaults, validation against venue markets
    engine.ts         state machine + cycle orchestration (pure transitions, DB effects in service)
    service.ts        start / pause / resume / extend / kill / end (DB + notifications)
    cycle.ts          one decision cycle: context → agents → risk → execute → room
  agents/
    context.ts        builds the data block (market report, indicators, news, positions, exit plans, lessons, mandate usage)
    analysts.ts       market + news analysts (aiJson, cheap model)
    debate.ts         optional bull/bear single round
    strategist.ts     proposals + position management (hold / close / tighten SL) with exit plan
    journal.ts        per-trade lesson + end-of-session report
    schemas.ts        zod + JSON schemas for every agent output
  risk/
    limits.ts         pure functions: allowlist, sizing, leverage, exposure, counts, cooldown, fee hurdle, daily limits
    verdict.ts        Proposal → {approved | clamped | rejected, reasons[]}
  venues/
    types.ts          Venue interface
    paper.ts          simulated fills using lib/paper/engine math (fees, slippage, liquidation)
    ccxt.ts           ccxt adapter (spot + swap, sandbox, precision, limits, clientOrderId)
    registry.ts       venue from ExchangeConnection (decrypts keys; worker-only)
  exec/
    executor.ts       intent → order → fill; idempotent clientOrderId; timeout lookup-before-retry; partial fills
    protect.ts        exchange-native reduce-only SL/TP when supported, else software stops via price watcher
    reconciler.ts     every 30s + boot: open orders, order status, trades, balances/positions vs DB → mismatch ⇒ HALT
    priceWatch.ts     15s mark prices for symbols with open session positions (software stops, loss limit)
  secrets/
    crypto.ts         AES-256-GCM encrypt/decrypt with key version
  notify/telegram*    + inline keyboards, callback queries, session commands
worker/
  index.ts            boots: tick (existing), session scheduler, priceWatch, reconciler, Telegram long-poll; graceful shutdown
app/
  (app)/sessions/            list + daily limits usage
  (app)/sessions/new         mandate form (paper default; live needs typed confirm)
  (app)/sessions/[id]        room: chat stream, positions panel with actions, mandate meters, report tab
  (app)/settings/exchanges   connections: add, test, delete
  api/sessions/**            start, control (pause/resume/extend/kill/close position/move SL), messages (cursor), report
  api/exchanges/**           CRUD + test
```

### 4.1 Venue interface

```ts
interface Venue {
  id: string; kind: "paper" | "ccxt" | "oanda" | "mt5"; live: boolean;
  loadMarkets(): Promise<MarketInfo[]>;                 // symbol, type, min amount/cost, precision, maxLeverage
  balance(): Promise<{ free: number; total: number; currency: string }>;
  positions(): Promise<VenuePosition[]>;                // swap; spot derives from balances
  setLeverage?(symbol: string, leverage: number, marginMode: "isolated" | "cross"): Promise<void>;
  placeOrder(o: OrderIntent): Promise<VenueOrder>;       // o.clientOrderId required
  fetchOrder(ref: { id?: string; clientOrderId: string; symbol: string }): Promise<VenueOrder | null>;
  openOrders(symbol?: string): Promise<VenueOrder[]>;
  cancelOrder(ref: { id: string; symbol: string }): Promise<void>;
  cancelAll(symbol?: string): Promise<void>;
  supportsNativeStops(symbol: string): boolean;
}
```

The paper venue implements the same interface over DB tables, so the session engine, risk engine and room are identical for paper and live.

### 4.2 Data model (new)

```
ExchangeConnection(id, userId, exchange, label, marketTypes[], sandbox, apiKeyEnc, secretEnc, passwordEnc?, uidEnc?, keyVersion, keyLast4, status[UNVERIFIED,OK,ERROR], lastCheckedAt, lastError?, createdAt)
TradingSession(id, userId, name, status[RUNNING,PAUSED,AWAITING_EXTENSION,ENDING,ENDED,HALTED], live, venue, connectionId?, mandate Json, startedAt, endsAt, endedAt?, endReason?[COMPLETED,USER_ENDED,LOSS_LIMIT,KILL,RECONCILE_MISMATCH,LLM_BUDGET,ERROR,EXTENSION_TIMEOUT], startingEquity, realizedPnl, fees, llmCostUsd, tradesCount, lastCycleAt?, nextCycleAt?, extensionPromptAt?, createdAt)
SessionPosition(id, sessionId, symbol, side, qty, entryPrice, leverage, margin?, stopLoss?, takeProfit?, exitPlan Json, openedAt, closedAt?, closePrice?, realizedPnl?, fees, closeReason?, journalEntryId?)
SessionOrder(id, sessionId, positionId?, clientOrderId(unique), venueOrderId?, symbol, side, type, purpose[ENTRY,EXIT,STOP,TAKE_PROFIT], reduceOnly, amount, price?, status[PENDING,OPEN,PARTIAL,FILLED,CANCELED,REJECTED,UNKNOWN], filled, avgPrice?, fee?, error?, createdAt, updatedAt)
SessionMessage(id, sessionId, role[MARKET,NEWS,BULL,BEAR,STRATEGIST,RISK,EXECUTOR,JOURNAL,SYSTEM,USER], kind[TEXT,PROPOSAL,VERDICT,ORDER,FILL,ALERT,REPORT], body, data Json?, aiUsageId?, createdAt)  @@index(sessionId, createdAt)
SessionReport(id, sessionId(unique), summary, metrics Json, lessons Json, createdAt)
UserTradingLimits(userId(unique), maxDailyLoss?, maxSessionsPerDay?, updatedAt)
```

`JournalEntry.pnlSource` gains `SESSION`; `JournalEntry` gets optional `sessionPositionId`.

### 4.3 Session lifecycle

```
start ──► RUNNING ──(pause)──► PAUSED ──(resume)──► RUNNING
RUNNING ──(now ≥ endsAt)──► AWAITING_EXTENSION ──(extend)──► RUNNING (endsAt += N)
                                               ──(close/keep answer or timeout)──► ENDING ──► ENDED
any ──(loss limit | kill | reconcile mismatch | fatal venue error)──► HALTED (cancel all, close all, notify)
```

- PAUSED and AWAITING_EXTENSION: no new entries; stops, loss limit and reconciler keep running.
- ENDING applies `onEnd`: `CLOSE_ALL` closes positions at market; `KEEP_WITH_STOPS` leaves positions with exchange-native stops (refused for venues without native stops → falls back to `CLOSE_ALL`, stated in the room).
- On worker boot, sessions in RUNNING/PAUSED/AWAITING_EXTENSION/ENDING are resumed after a reconcile pass; a session whose `endsAt + extensionTimeoutMin` passed while the worker was down goes straight to ENDING.

### 4.4 Decision cycle

1. Skip if not RUNNING, LLM budget exhausted, or no trigger (interval not due and no event).
2. Build context: market report + indicators for each allowed symbol (`lib/market`), recent news, balances/positions from the venue, open positions with their exit plans, mandate usage (loss used, trades left, time left), top-k lessons.
3. Analysts (parallel, cheap model) → short structured notes → room.
4. Optional bull/bear single round → room.
5. Strategist → `{ decisions: [{ action: OPEN_LONG|OPEN_SHORT|CLOSE|TIGHTEN_STOP|HOLD, symbol, conviction 0–1, thesis, exitPlan{takeProfit, stopLoss, invalidation, horizonMin}, positionId? }] }` → room.
6. Risk engine per decision → verdict with reasons (approved / clamped with new size / rejected) → room. Sizing: `qty = min(riskPerTrade / |entry − stop|, maxPosition, venue limits)` rounded by venue precision; rejected if below venue minimum or if expected move to TP does not cover round-trip fees + slippage.
7. Executor for approved decisions → orders/fills → room; protective stops placed (§4.5).
8. Record `lastCycleAt`, `nextCycleAt`, LLM cost.

Any agent failure (timeout, schema error, refusal) posts a SYSTEM message and the cycle ends without trading; three consecutive failures pause the session and notify.

### 4.5 Execution safety

- Intent first: `SessionOrder` row with status PENDING and a deterministic `clientOrderId = ab-<session6>-<cycle>-<n>` (trimmed to venue rules) before calling the venue.
- On `RequestTimeout`/network error from `placeOrder`: status UNKNOWN → look up by `clientOrderId` (fetchOrder, then open/closed orders); never blind-retry an order placement.
- Partial fills tracked (`filled`, `avgPrice`); protective orders sized to the filled amount; limit entries not filled within `limitTimeoutSec` are canceled (optionally re-sent at market).
- Protective stops: exchange-native reduce-only stop-market (+ TP) when `supportsNativeStops`; otherwise software stops checked by `priceWatch` every 15 s (stated in the room at session start).
- Reconciler every 30 s and on boot compares venue open orders, order states, positions/balances with DB. Unknown venue orders or position size mismatch beyond precision tolerance ⇒ HALT + notify. The venue is the source of truth.
- ccxt: pinned exact version, one instance per connection cached in the worker, `enableRateLimit` on, `adjustForTimeDifference: true`, `setSandboxMode` right after construction, `loadMarkets` at start and every 6 h, `amountToPrecision`/`priceToPrecision`. Reads retried on network errors; `InsufficientFunds`/`InvalidOrder` terminal.
- Kill switch: web button, Telegram `/kill` (+ confirm), and env `TRADING_HALT=1` (checked before every order). Kill = cancel all session orders, close all session positions, HALTED.

### 4.6 Telegram

Extends P6 (`lib/notify/telegram*`). The worker uses `getUpdates` long-polling (timeout 25 s) with `allowed_updates: ["message", "callback_query"]`; the tick no longer polls.

- Commands: `/sessions`, `/positions`, `/pause`, `/resume`, `/kill`, `/help` (existing `/start CODE`, `/stop` kept).
- `/positions`: one message per open position — symbol, side, qty, entry, mark, P&L, SL/TP — with buttons `Close`, `Close 50%`, `SL → breakeven`.
- Session events pushed: start, each fill, each close (with P&L), risk rejections (batched per cycle), halts, report link.
- End prompt (E10) buttons: `Extend 1h`, `Extend 2h`, `Close all`, `Keep with stops`; the message is edited to show the outcome (or "No answer — session ended, positions closed").
- Security: callbacks are accepted only from the chat linked to the session owner; `callback_data` holds a short opaque token mapped server-side to (sessionId, action, positionId) with 24 h expiry; destructive actions need a second confirm tap.

### 4.7 Web UI

- `/sessions`: running and past sessions, today's usage vs daily limits, "New session".
- `/sessions/new`: mandate form with defaults, venue picker (paper default), live warning block + typed "LIVE" confirm, estimated LLM cost per session.
- `/sessions/[id]`:
  - Header meters: time left, loss used / limit, trades used / max, LLM cost / cap, P&L (realized + unrealized, net of fees).
  - Room: chat stream grouped by cycle, role avatars, proposals and verdicts rendered as cards; polling by cursor every 3 s while open.
  - Positions panel with the same actions as Telegram; Pause / Resume / Extend / End / Kill.
  - Report tab after end.
- `/settings/exchanges`: add connection (exchange from ccxt list, keys, sandbox toggle), "Test" (loadMarkets + balance; warns when the venue reports withdraw permission, where detectable), delete.
- All pages follow the P7 tokens, a11y rules and the disclaimer gate.

### 4.8 Journal agent and report

- On each position close: one call → `TradeLesson` (what was the thesis, what happened, mistake/strength, lesson) and a `JournalEntry` (`pnlSource = SESSION`).
- On session end: `SessionReport` with metrics computed in code (net P&L, fees, LLM cost, win rate, expectancy R, max drawdown, trades, risk rejections by reason, vs buy-and-hold of the first allowed symbol over the session window) and an LLM-written narrative summary + lessons. Sent to Telegram as a summary with a link.

## 5. Phases

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **P8a · Sessions on paper** | Models + migration, mandate, risk engine, paper venue, agents, cycle, lifecycle, worker process (tick moved), room UI, journal + report, Telegram interactive (paper) | Tests green; an 8 h paper session runs end-to-end on real market data with visible room, Telegram controls, extension prompt + 5 min timeout, report |
| **P8b · Live via ccxt** | Encrypted connections, ccxt venue (spot + swap), executor safety, native/software stops, reconciler, kill switch, live gating | Binance Spot Testnet session passes (orders, partial fills, kill, reconcile); then a small live session on the owner's exchange; then a small swap session |
| **P9 · Forex & metals** | `oanda` venue (practice + live; FX, XAU, XAG), market data for FX/metals in `lib/market`, session hours awareness; optional MT5 bridge (MetaApi) | OANDA practice session end-to-end |

## 6. Testing

- Unit (TDD, pure): mandate validation, sizing and every risk rule, verdict reasons, lifecycle transitions, clientOrderId, fee hurdle, report metrics, Telegram callback token mapping, AES-GCM round-trip + tamper detection.
- DB tests (`tests/db`): session service transitions, cycle with stubbed agents + paper venue, reconciler diff with a fake venue (unknown order, size mismatch, UNKNOWN order resolution), extension timeout, HALT on loss limit.
- Agents: schema validation with recorded fixtures; no live LLM calls in CI.
- Integration (opt-in, `CCXT_TESTNET=1` + keys): Binance Spot Testnet place/fetch/cancel/partial fill.
- Live verification per phase in the running app, per the usual phase loop.

## 7. Configuration (new env)

`LIVE_TRADING_ENABLED` (default off), `EXCHANGE_KEY_SECRET` (32-byte base64; required for connections), `TRADING_HALT` (emergency), `WORKER_ENABLED` / `TICK_DISABLED` semantics documented in HANDOFF; Railway gets a second service `worker` from the same image.

## 8. Non-goals (P8)

Multi-model arena; strategy backtesting of LLM agents on history (look-ahead bias); options; copy-trading or managing other people's funds; multiple venues inside one session; mobile app; Telegram free-text commands to agents (only buttons/commands).

## 9. Risks and open points

- **LLM agents are not expected to be profitable.** The report always shows P&L net of fees and LLM cost against buy-and-hold.
- MEXC futures API order placement was historically restricted to some accounts — verify before relying on it. Exchange-native stop support varies per venue; the room states which stop mode is active.
- Worker is a single instance; two workers would double-trade. The worker takes a Postgres advisory lock at boot and exits if it cannot get it.
- Railway outbound IPs may change, which breaks exchange IP allowlists — document; static egress is a Railway plan feature to check.
- Next 16 build: ccxt must not enter the web bundle; the worker is built separately (esbuild) and the Dockerfile copies `dist/worker.js` + its `node_modules`.
- Legal/regulatory suitability of any exchange for the deployment owner is the owner's responsibility; README states this.
