# P8a · Agent Trading Sessions on Paper — Implementation Plan

> For agentic workers: execute task by task, TDD (failing test first), commit after each task. Steps use `- [ ]`.

**Goal:** A user starts a time-boxed session with a mandate; LLM agents discuss and propose trades in a visible room; a deterministic risk engine approves/clamps/rejects; a paper venue fills; stops, loss limit and session end are enforced by code; Telegram shows and manages positions and asks to extend at the end; a journal agent writes lessons and a report.

**Spec:** `docs/superpowers/specs/2026-09-28-p8-agent-trading-sessions-design.md` (E1–E20, §3, §4 minus ExchangeConnection/ccxt/reconciler which are P8b).
**Research:** `docs/superpowers/research/2026-09-28-p8-agents-exchanges.md`.

## Global constraints

- Next.js 16.2.4, Prisma 6, zod 4, Vitest 3. Read `node_modules/next/dist/docs/` before using a Next API.
- DB access server-only, `userId` on every query; routes via `userRoute`/`userIdRoute`, bodies via `readJson`, errors as `HttpError`.
- AI only via `aiJson()` with a zod schema **and** a closed `jsonSchema`; every call logs `AiUsage` with `feature: "session.<role>"`.
- Numbers (prices, sizes, P&L, indicators) never come from the LLM (E15). No fabricated values: unavailable data → the cycle refuses to trade and says why.
- Mandate limits enforced in code (E2); exits never wait for the LLM (E3).
- UI: P7 tokens/components, Tailwind only, a11y (labels, focus, AA contrast), no inline styles.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings (deviations/decisions made while planning)

- **Worker mode.** Ruling: P8a adds `lib/worker/` with `startWorker()`; `WORKER_MODE=inline` (default) runs it inside the web process from `instrumentation.ts` (as the tick does today), `WORKER_MODE=separate` makes the web process start nothing and `npm run worker` (tsx) runs it. A Postgres advisory lock guarantees one worker. The esbuild-bundled production worker image is deferred to P8b, when ccxt arrives — why: P8a has no ccxt, and single-service Railway deploys keep working. Cost if wrong: one extra Dockerfile step later.
- **Paper venue fills** use the P4 fill model (`applySlippage`, `FEE_RATE`) at the live quote; software stops/TP/liquidation are checked on the live quote every 15 s (not candle high/low) — mirrors how a real software stop behaves.
- **Symbols**: any `ASSET_CATALOG` symbol (paper can trade XAU/USD, EUR/USD via Yahoo quotes). `spot` forbids shorts and leverage > 1.
- **LLM budget hit** → no new cycles (`llmBudgetHit = true`), stops keep running, session continues to its end.
- **Event triggers**: interval due, a position closed since the last cycle, or |price move| ≥ 1.5 % on an allowed symbol since the last cycle. An interval cycle is skipped (no LLM call) when no position is open, every symbol moved < 0.2 %, and the previous cycle was all-HOLD; at most 2 consecutive skips.
- **Telegram callbacks** use a `TelegramAction` table (opaque 16-char token → user, session, action, position, expiry 24 h).

## File map

```
prisma/schema.prisma (+ migration p8a_sessions)
lib/sessions/mandate.ts        zod Mandate, defaults, MandateInput
lib/sessions/lifecycle.ts      pure state machine: canTransition, nextStatusOnTimer
lib/sessions/service.ts        startSession, pauseSession, resumeSession, extendSession, endSession, killSession, closeSessionPosition, moveStopToBreakeven, sessionView, listSessions
lib/sessions/monitor.ts        monitorSessions(now): stops/TP/liquidation, loss limit, end → AWAITING_EXTENSION, timeout → ENDING, due cycles
lib/sessions/cycle.ts          runCycle(sessionId, deps)
lib/sessions/room.ts           post(sessionId, role, kind, body, data?) + listMessages
lib/sessions/report.ts         computeMetrics (pure) + writeReport
lib/sessions/journal.ts        journalClosedPosition (JournalEntry + TradeLesson)
lib/sessions/limits.ts         daily limits (UserTradingLimits) usage
lib/risk/limits.ts, verdict.ts pure risk engine
lib/venues/types.ts, paper.ts  Venue interface + paper venue (session ledger)
lib/agents/schemas.ts          zod + JSON schemas: analystNote, debate, strategistPlan, tradeLesson, sessionSummary
lib/agents/context.ts          buildContext(session, deps) → data block
lib/agents/prompts.ts          system prompts per role
lib/agents/run.ts              runAnalysts, runDebate, runStrategist, runJournal (inject aiJson)
lib/ai/index.ts                AiRequest.model override
lib/worker/index.ts            startWorker(): advisory lock, tick 60 s, monitor 15 s, telegram long-poll
lib/notify/telegram.ts         + callback queries, inline keyboards, edit/answer
lib/notify/telegramBot.ts      processBotUpdate: link/unlink (moved), /sessions /positions /pause /resume /kill /help, callbacks
lib/notify/sessionTelegram.ts  pushes: start, fill, close, halt, extension prompt, report
scripts/worker.ts              `npm run worker` entry
app/api/sessions/**            routes
app/sessions/**, components/sessions/**, hooks/useSessions.ts
```

---

### Task 1: Schema + migration

**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_p8a_sessions/migration.sql`

Models (P8a subset of spec §4.2):

```prisma
enum SessionStatus { RUNNING PAUSED AWAITING_EXTENSION ENDING ENDED HALTED }
enum SessionEndReason { COMPLETED USER_ENDED LOSS_LIMIT KILL RECONCILE_MISMATCH LLM_BUDGET ERROR EXTENSION_TIMEOUT }
enum SessionRole { MARKET NEWS BULL BEAR STRATEGIST RISK EXECUTOR JOURNAL SYSTEM USER }
enum SessionMessageKind { TEXT PROPOSAL VERDICT ORDER FILL ALERT REPORT }
enum SessionOrderStatus { PENDING OPEN PARTIAL FILLED CANCELED REJECTED UNKNOWN }
enum SessionOrderPurpose { ENTRY EXIT STOP TAKE_PROFIT }
enum SessionCloseReason { MANUAL STRATEGIST STOP_LOSS TAKE_PROFIT LIQUIDATION LOSS_LIMIT KILL SESSION_END }

model TradingSession { id, userId→User, name, status SessionStatus @default(RUNNING), live Boolean @default(false),
  venue String @default("paper"), mandate Json, startedAt, endsAt, endedAt?, endReason SessionEndReason?,
  capital Float, realizedPnl Float @default(0), fees Float @default(0), llmCostUsd Float @default(0),
  tradesCount Int @default(0), cycleCount Int @default(0), skipStreak Int @default(0), llmBudgetHit Boolean @default(false),
  agentFailStreak Int @default(0), lastCycleAt?, nextCycleAt?, lastPrices Json?, startPrices Json?,
  extensionPromptAt DateTime?, extensionChatId String?, extensionMessageId Int?, createdAt, updatedAt
  positions SessionPosition[] orders SessionOrder[] messages SessionMessage[] report SessionReport? actions TelegramAction[]
  @@index([userId, createdAt]) @@index([status]) }
model SessionPosition { id, sessionId→TradingSession, symbol, side PaperSide, qty Float, entryPrice Float, leverage Float, margin Float,
  stopLoss Float?, takeProfit Float?, exitPlan Json, openedAt, closedAt?, closePrice?, realizedPnl?, fees Float, closeReason SessionCloseReason?,
  journalEntryId String? @unique  @@index([sessionId, closedAt]) }
model SessionOrder { id, sessionId, positionId?, clientOrderId String @unique, venueOrderId?, symbol, side PaperOrderAction, type String,
  purpose SessionOrderPurpose, reduceOnly Boolean, amount Float, price Float?, status SessionOrderStatus, filled Float @default(0),
  avgPrice Float?, fee Float?, error String?, createdAt, updatedAt  @@index([sessionId, createdAt]) }
model SessionMessage { id, sessionId, role SessionRole, kind SessionMessageKind, body String, data Json?, costUsd Float?, cycle Int?, createdAt  @@index([sessionId, createdAt]) }
model SessionReport { id, sessionId @unique, summary String, metrics Json, lessons Json, createdAt }
model UserTradingLimits { userId @id→User, maxDailyLoss Float?, maxSessionsPerDay Int?, updatedAt }
model TelegramAction { token String @id, userId, sessionId?→TradingSession, action String, positionId String?, expiresAt, usedAt? @@index([expiresAt]) }
```

`JournalEntry`: add `sessionPositionId String? @unique`.

- [ ] Edit schema; generate migration with the shadow-DB workaround from HANDOFF (`prisma migrate diff … --shadow-database-url …/alphaboard_shadow`), `migrate deploy`, `prisma generate`.
- [ ] `npm run typecheck`; `npm run test:db` still green. Commit `feat(p8a): session schema`.

### Task 2: Mandate

**Files:** `lib/sessions/mandate.ts`, `tests/unit/sessionMandate.test.ts`
**Produces:** `MandateSchema` (zod, strict), `type Mandate`, `MANDATE_DEFAULTS`, `parseMandate(input: unknown): Mandate` (applies defaults, cross-field rules), `type ModelRef = { provider: string; model: string }`.

Fields and bounds (spec §3): `venue: "paper"`, `marketType: "spot"|"swap"`, `symbols` 1–10 catalog symbols (unique), `capital` 10–10,000,000, `maxLeverage` 1–50 (spot ⇒ must be 1), `marginMode: "isolated"`, `riskPerTradePct` 0.1–10 (default 1), `maxPositionPct` 5–100 (50), `maxOpenPositions` 1–10 (2), `maxTrades` 1–100 (6), `lossLimit` > 0 and ≤ capital (default 10 % of capital), `durationMin` 15–1440 (480), `decisionIntervalMin` 5–240 (30), `cooldownMin` 0–1440 (30), `onEnd: "CLOSE_ALL"|"KEEP_WITH_STOPS"` (CLOSE_ALL), `extensionTimeoutMin` 1–60 (5), `orderStyle: "market"` (P8a paper supports market only; `limit_post_only` rejected with a clear message until P8b), `models: { analyst, strategist, journal }` each `ModelRef | null`, `debate` (false), `maxLlmCostUsd` 0.05–100 (1).

Tests: defaults fill; spot+leverage 2 rejected; unknown symbol rejected; lossLimit > capital rejected; duplicate symbols rejected; lossLimit default = 10 % capital.

- [ ] Test → fail → implement → pass → commit.

### Task 3: Risk engine (pure)

**Files:** `lib/risk/limits.ts`, `lib/risk/verdict.ts`, `tests/unit/riskEngine.test.ts`
**Consumes:** `Mandate`.
**Produces:**

```ts
export interface Proposal { action: "OPEN_LONG"|"OPEN_SHORT"|"CLOSE"|"TIGHTEN_STOP"|"HOLD"; symbol: string; conviction: number; thesis: string;
  exitPlan: { takeProfit: number|null; stopLoss: number|null; invalidation: string; horizonMin: number }; positionId: string|null }
export interface RiskState { equity: number; freeCapital: number; openPositions: Array<{ id: string; symbol: string; side: "LONG"|"SHORT"; qty: number; entryPrice: number; stopLoss: number|null; margin: number }>;
  tradesCount: number; lastStopOutAt: Record<string, number>; now: number; dailyLossUsed: number; dailyLossLimit: number|null; sessionLoss: number }
export interface MarketRules { price: number; minQty: number; minCost: number; qtyStep: number; feeRate: number; slippage: number }
export type Verdict =
  | { kind: "approved"|"clamped"; side: "LONG"|"SHORT"; qty: number; leverage: number; margin: number; stopLoss: number; takeProfit: number|null; reasons: string[] }
  | { kind: "close"; positionId: string; reasons: string[] }
  | { kind: "tighten"; positionId: string; stopLoss: number; reasons: string[] }
  | { kind: "rejected"; reasons: string[] }
  | { kind: "hold"; reasons: string[] };
export function evaluateProposal(p: Proposal, m: Mandate, s: RiskState, r: MarketRules | null): Verdict
```

Rules (each rejection/clamp adds a human-readable reason, e.g. `"size clamped 0.52 → 0.31 BTC: risk per trade 1% = $10"`):
1. `HOLD` → hold. Symbol not in allowlist → rejected. `r == null` (no live price) → rejected "price unavailable".
2. CLOSE/TIGHTEN need an open `positionId` in state. TIGHTEN only moves the stop toward the price (LONG: higher, still < price; SHORT: lower, still > price), else rejected.
3. OPEN_SHORT on spot → rejected. Session loss ≥ lossLimit, daily loss limit reached, tradesCount ≥ maxTrades, open positions ≥ maxOpenPositions, already a position on that symbol, cooldown after a stop-out on that symbol → rejected.
4. Stop required: missing or on the wrong side of price → rejected. Take-profit on the wrong side → dropped (null) with reason.
5. Sizing: `riskUsd = equity × riskPerTradePct/100`; `qtyRisk = riskUsd / |price − stop|`; leverage = `mandate.maxLeverage` (spot 1); `qtyCap = min(freeCapital, capital × maxPositionPct/100) × leverage / price`; `qty = floorToStep(min(qtyRisk, qtyCap))`; if clamped → kind "clamped".
6. `qty < minQty` or `qty × price < minCost` → rejected "below venue minimum".
7. Fee hurdle: when TP set, expected gross `|tp − price| × qty` must exceed round-trip `2 × (feeRate + slippage) × price × qty` × 1.5, else rejected.
8. Liquidation guard (swap, leverage > 1): stop must be inside liquidation (`liquidationPrice` from `lib/paper/engine`), else rejected.

Tests: one per rule, plus a happy path with exact qty math.

- [ ] Test → fail → implement → pass → commit.

### Task 4: Venue interface + paper venue

**Files:** `lib/venues/types.ts`, `lib/venues/paper.ts`, `tests/db/sessionPaperVenue.test.ts`
**Produces:**

```ts
export interface VenueFill { orderId: string; clientOrderId: string; price: number; qty: number; fee: number }
export interface Venue {
  kind: "paper"; live: false;
  marketRules(symbol: string): Promise<MarketRules | null>;
  openPosition(i: { sessionId: string; clientOrderId: string; symbol: string; side: "LONG"|"SHORT"; qty: number; leverage: number; stopLoss: number; takeProfit: number|null; exitPlan: unknown }): Promise<{ positionId: string; fill: VenueFill }>;
  closePosition(i: { sessionId: string; clientOrderId: string; positionId: string; reason: SessionCloseReason; fraction?: number; price?: number }): Promise<{ fill: VenueFill; realizedPnl: number; closed: boolean } | null>;
  setStop(positionId: string, stopLoss: number): Promise<void>;
}
export function paperVenue(priceOf: PriceOf): Venue
```

Paper semantics: fill at `applySlippage(action, price)`, fee `notional × FEE_RATE` each side, `margin = notional/leverage`; records `SessionOrder` (status FILLED, purpose ENTRY/EXIT/STOP/TAKE_PROFIT) and updates `SessionPosition` + session `realizedPnl`, `fees`, `tradesCount` (entries only) in one transaction. Close is idempotent (`updateMany where closedAt null`); partial close (`fraction` 0.5) reduces qty/margin and books proportional P&L. `clientOrderId` unique ⇒ replay returns the existing order instead of double-filling. `marketRules`: price from `priceOf`; minQty/qtyStep 1e-8, minCost 1 (paper), feeRate FEE_RATE, slippage SLIPPAGE.

Tests: open → ledger; duplicate clientOrderId → no second fill; partial then full close P&L; close after close → null.

- [ ] Test → fail → implement → pass → commit.

### Task 5: AI model override + agent schemas/prompts/runners

**Files:** `lib/ai/index.ts` (+ `tests/unit/aiJson.test.ts` case), `lib/agents/schemas.ts`, `lib/agents/prompts.ts`, `lib/agents/context.ts`, `lib/agents/run.ts`, `tests/unit/agentSchemas.test.ts`, `tests/unit/agentsRun.test.ts`

- `AiRequest.model?: ModelRef | null` — used before the user's preference in `resolveModel` (ignored when not configured). Test: override wins; unconfigured override falls back.
- Schemas (zod + closed JSON schema, consistency test like `jsonSchemas.test.ts`):
  - `AnalystNote = { stance: "bullish"|"bearish"|"neutral", confidence: 0–1, summary ≤ 600 chars, keyPoints: string[] ≤ 5 }` per symbol → `{ notes: [{ symbol, ...AnalystNote }] }`.
  - `DebateTurn = { bull: string, bear: string }`.
  - `StrategistPlan = { decisions: Proposal[] (≤ 10), commentary: string }` (Proposal as Task 3, numbers nullable).
  - `TradeLessonOut = { outcome: "WIN"|"LOSS"|"BREAKEVEN", rootCause, mistakes[], strengths[], lesson, tags[] }`.
  - `SessionSummaryOut = { summary: string, lessons: string[] ≤ 5 }`.
- `buildContext({ mandate, symbols data, positions, usage, lessons })` returns a compact text data block: per symbol price, 1H/4H/1D trend + stretch + RSI + ATR, consensus score, funding for swap when available (`getFutures`), top 5 news headlines with sentiment; open positions with entry, mark, unrealized, SL/TP and persisted exit plan; mandate usage (loss used/limit, trades left, time left, LLM cost/cap); up to 5 lessons. Unavailable data is written as "unavailable". Pure formatter `formatContext(data)` is unit-tested; `gatherContext(session, deps)` does the IO.
- Runners take an injected `ai: typeof aiJson`: `runAnalysts` (market + news, parallel, analyst model, maxTokens 900), `runDebate` (strategist model), `runStrategist` (strategist model, maxTokens 1800), `runTradeLesson`, `runSessionSummary` (journal model). Each returns `{ data, costUsd }`.
- Tests with a stub `ai` that returns fixtures: runners pass the right feature names/models; strategist decisions are post-validated (symbols not in allowlist dropped with a note).

- [ ] Test → fail → implement → pass → commit.

### Task 6: Room, lifecycle and session service

**Files:** `lib/sessions/room.ts`, `lib/sessions/lifecycle.ts`, `lib/sessions/limits.ts`, `lib/sessions/service.ts`, `tests/unit/sessionLifecycle.test.ts`, `tests/db/sessions.test.ts`

- `lifecycle.ts` (pure): `canTransition(from, to)`, `ACTIVE_STATUSES`, `acceptsEntries(status)` (RUNNING only), `timerTransition({status, now, endsAt, extensionPromptAt, extensionTimeoutMin})` → `"PROMPT_EXTENSION" | "EXTENSION_TIMEOUT" | null`.
- `room.post(sessionId, role, kind, body, data?, extra?)`; `listMessages(userId, sessionId, after?: string)` (owner check, ascending, ≤ 200).
- `limits.ts`: `dailyUsage(userId, now)` → `{ sessionsToday, lossToday }` (sessions started since UTC midnight; loss = −min(0, Σ realizedPnl − fees)), `getLimits/setLimits`.
- `service.ts`:
  - `startSession(userId, input)` → parse mandate, check daily limits (`maxSessionsPerDay`, `maxDailyLoss` reached) → create session (`endsAt`, `nextCycleAt = now`, `startPrices`), SYSTEM message with mandate summary; returns view. Live flag rejected in P8a.
  - `pauseSession`, `resumeSession`, `extendSession(userId, id, minutes)` (from RUNNING or AWAITING_EXTENSION; clears prompt fields; `endsAt = max(endsAt, now) + minutes`), `endSession(userId, id, mode: "CLOSE_ALL"|"KEEP_WITH_STOPS", reason)`, `killSession(userId, id)` (close all at market, HALTED/KILL), `closeSessionPosition(userId, positionId, fraction?)`, `moveStopToBreakeven(userId, positionId)`.
  - Every action posts a USER/SYSTEM room message and notifies (in-app + Telegram via `notify`).
  - `sessionView(userId, id, priceOf)` DTO: session, mandate, meters (timeLeftMs, lossUsed, lossLimit, trades, maxTrades, llmCost, cap), positions with mark/unrealized (null when price unavailable), equity, net P&L. `listSessions(userId)`.
- DB tests: start/pause/resume/extend/end/kill transitions and ownership (other user 404), daily limit refusal, kill closes positions.

- [ ] Test → fail → implement → pass → commit.

### Task 7: Decision cycle

**Files:** `lib/sessions/cycle.ts`, `tests/db/sessionCycle.test.ts`
**Produces:** `runCycle(sessionId: string, deps: { ai, priceOf, venue?, now?, gather? }): Promise<{ ran: boolean; skipped?: string; decisions: number; executed: number }>`

Steps (spec §4.4): guard (RUNNING, not llmBudgetHit, due or triggered); skip rule (Rulings); gather context; analysts → room (MARKET/NEWS); optional debate → room (BULL/BEAR); strategist → room (PROPOSAL cards with data); risk verdict per decision → room (RISK, VERDICT with reasons); execute approved via venue → room (EXECUTOR, FILL); update `llmCostUsd`, `cycleCount`, `lastCycleAt`, `nextCycleAt = now + interval`, `lastPrices`, `skipStreak`, `agentFailStreak`; `llmCostUsd ≥ maxLlmCostUsd` → `llmBudgetHit` + SYSTEM message. Agent error → SYSTEM message, no trading; 3 consecutive → PAUSED + notify. A per-process `Set` prevents concurrent cycles for one session.

DB test with stub `ai` + stub `priceOf`: approved long opens a position with the risk-engine qty; a rejected proposal posts a VERDICT with reasons and no order; LLM budget flag; agent failure streak pauses.

- [ ] Test → fail → implement → pass → commit.

### Task 8: Monitor (stops, loss limit, timers) + journal + report

**Files:** `lib/sessions/monitor.ts`, `lib/sessions/journal.ts`, `lib/sessions/report.ts`, `tests/unit/sessionReport.test.ts`, `tests/db/sessionMonitor.test.ts`

- `monitorSessions({ now, priceOf, ai, telegram })` for active sessions:
  1. For each open position: live price → SL / TP / liquidation (swap) hit → `venue.closePosition` with reason → room + notify → `journalClosedPosition`.
  2. Loss limit: `realized − fees + unrealized ≤ −lossLimit` → HALTED/LOSS_LIMIT, close all.
  3. Timers via `timerTransition`: RUNNING/PAUSED past `endsAt` → AWAITING_EXTENSION + Telegram prompt (Task 9) + room; AWAITING past timeout → ENDING with `onEnd` (reason EXTENSION_TIMEOUT); ENDING → apply `onEnd` → ENDED + `writeReport`.
  4. RUNNING and cycle due/triggered → `runCycle` (not awaited in series with stops: cycles run after the stop pass; one cycle per session at a time).
- `journalClosedPosition(positionId, ai)`: `JournalEntry` (symbol, LONG/SHORT, CLOSED, entry/exit, pnlPercent = realized / margin × 100, `pnlSource: "SESSION"`, emotion `"Agent"`, notes = thesis + invalidation, leverage, margin, `sessionPositionId`) + `TradeLesson` from `runTradeLesson` (failure → entry without lesson, SYSTEM message).
- `computeMetrics(positions, session, startPrice, endPrice)` (pure): net P&L, fees, LLM cost, net after LLM, win rate, expectancy (R using initial stop distance stored in exitPlan), max drawdown on the closed-trade equity curve, trades, rejections by reason (from VERDICT messages), buy-and-hold % of first symbol. `writeReport(sessionId, ai)` stores metrics + `runSessionSummary` narrative; room REPORT message; notify with link.
- Tests: metrics math (pure); monitor closes on SL and on loss limit; end → AWAITING → timeout → ENDED with positions closed and a report.

- [ ] Test → fail → implement → pass → commit.

### Task 9: Telegram interactive + worker

**Files:** `lib/notify/telegram.ts`, `lib/notify/telegramBot.ts`, `lib/notify/sessionTelegram.ts`, `lib/notify/telegramLink.ts` (link/unlink logic reused), `lib/worker/index.ts`, `lib/jobs/tick.ts` (remove Telegram polling), `lib/jobs/scheduler.ts`, `instrumentation.ts`, `scripts/worker.ts`, `package.json` (`worker` script), `tests/unit/telegramBot.test.ts`, `tests/db/telegramSessions.test.ts`

- Client: `updates(offset, timeoutSec)` returns `{ updateId, chatId, text?, callback?: { id, data, messageId } }` with `allowed_updates: ["message","callback_query"]`; `send(chatId, text, keyboard?) → messageId`; `edit(chatId, messageId, text, keyboard?)`; `answer(callbackId, text?)`. Keyboards: `Array<Array<{ text, data }>>`.
- `processBotUpdate(update, tg, now)`: existing `/start CODE` and `/stop`; for linked chats `/sessions` (status + buttons Pause/Resume/Kill per active session), `/positions` (one message per open position with `Close`, `Close 50%`, `SL → BE`), `/pause`, `/resume`, `/kill` (list sessions with buttons), `/help`. Callbacks resolve `TelegramAction` by token, require `chatId === owner.telegramChatId`, not expired/used; destructive actions (`kill`, `close`) first answer with a confirm button (new token, action `confirm:<x>`). Actions call the service functions from Task 6.
- `sessionTelegram.ts`: `promptExtension(session)` sends "Session X reached its end. Extend?" with `Extend 1h`, `Extend 2h`, `Close all`, `Keep with stops`, stores chat/message id on the session; on outcome or timeout the message is edited ("No answer in 5 min — session ended, positions closed."). If Telegram is not linked, AWAITING still times out and the in-app notification carries the same buttons in the web room.
- Worker: `startWorker()` — `pg_try_advisory_lock(815001)` on a dedicated connection; loops: tick 60 s (existing `runTick`, minus Telegram), `monitorSessions` 15 s, Telegram long-poll loop (`timeout 25`, offset in `AppSetting telegram.offset`), all with overlap guards and error → `recordEvent`. `instrumentation.ts` calls `startWorker()` when `WORKER_MODE !== "separate"`; `scripts/worker.ts` for separate mode. `TICK_DISABLED=1` keeps working.
- Tests: bot command parsing and permission checks (unit, fake tg); callback token flow in DB (kill confirm → session HALTED; wrong chat ignored; expired token rejected).

- [ ] Test → fail → implement → pass → commit.

### Task 10: API routes

**Files:** `app/api/sessions/route.ts` (GET list + limits usage, POST start), `app/api/sessions/[id]/route.ts` (GET view), `app/api/sessions/[id]/control/route.ts` (POST `{ action: "pause"|"resume"|"extend"|"end"|"kill", minutes?, mode? }`), `app/api/sessions/[id]/messages/route.ts` (GET `?after=`), `app/api/sessions/[id]/report/route.ts`, `app/api/sessions/positions/[id]/route.ts` (POST `{ action: "close"|"close_half"|"breakeven" }`), `app/api/sessions/limits/route.ts` (GET/PUT), inputs in `lib/db/inputs.ts`.

All `userRoute`/`userIdRoute`, zod inputs, `readJson` caps. Kill/end rate-limited normally. `tsc` + lint clean. Commit.

### Task 11: UI

**Files:** `app/sessions/page.tsx`, `app/sessions/new/page.tsx`, `app/sessions/[id]/page.tsx`, `components/sessions/{SessionsList,MandateForm,SessionRoom,RoomMessage,SessionMeters,SessionPositions,SessionControls,SessionReport}.tsx`, `hooks/useSessions.ts`, `components/NavBar.tsx` (Sessions link).

- List: active + past sessions (status pill, P&L, duration), today's usage vs limits (editable), "New session".
- New: mandate form grouped (Market & venue · Capital & risk · Time · Agents & cost), defaults prefilled, inline validation from the API's zod errors, estimated LLM calls per session (`duration / interval × (2 + debate + 1)`).
- Room: header meters (time left, loss used/limit bar, trades, LLM cost/cap, net P&L), messages grouped by cycle with role labels (Market, News, Bull, Bear, Strategist, Risk, Executor, Journal, System, You), proposal/verdict cards (action, symbol, conviction, SL/TP, reasons), positions panel with Close / Close 50% / SL→BE, controls Pause/Resume/Extend 1h/End/Kill (Kill + End need a confirm dialog), extension banner with the same four buttons while AWAITING, Report tab when ended. Polling: view 5 s, messages by cursor 3 s, paused when the tab is hidden.
- States: loading, empty room ("First cycle starts within 15 s"), unavailable prices ("Unavailable").
- Commit.

### Task 12: Verification, docs, tracker

- [ ] `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build` all green.
- [ ] Live check (`npm run build && npm start -- -p 3001`): start a 20-min paper session on BTC/USDT + ETH/USDT with real data and the real LLM; watch cycles in the room; close a position from the web; use Telegram if configured; let it reach the end and confirm the extension prompt and the 5-minute timeout path; open the report and the journal entries. Then delete the test session data from the local account.
- [ ] Docs: HANDOFF (P8a done, worker mode, env), CHANGELOG, README (Sessions section, `WORKER_MODE`), `.env.example`.
- [ ] Notion: P8 cards + "لاگ به‌روزرسانی" line. Commit.
