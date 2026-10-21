# P12 · Signal Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Farjad writes a trade signal once in AlphaBoard. AlphaBoard posts it to his Telegram channel (@gheymat_today), and an expert advisor in his MetaTrader 5 terminal executes it with a broker-side stop and TPs. Fills, TP hits and stops go back to AlphaBoard and are posted as replies in the channel.

**Architecture:** AlphaBoard is the source of truth. Telegram is only an output, and nothing parses the channel. A `TradeSignal` row is created from an admin form; the channel post goes out through the channel bot (`sendMessage`, no polling). `mql5/SignalCopier.mq5` polls `GET /api/mt5/signals/next` every 3 s with a per-terminal device token, claims each job atomically and opens one position per TP (each leg has the shared SL and its own native TP). It reports every event to `POST /api/mt5/signals/:id/report`. The protocol is plain text lines and form-encoded bodies, because MQL5 has no JSON parser.

**Tech Stack:** Next.js 16 route handlers, Prisma/Postgres, zod 4, vitest (unit and db), MQL5 (`CTrade`, `WebRequest`, `OnTimer`, `OnTradeTransaction`).

**Spec:** this conversation (2026-10-21): "path 3". Farjad writes signals in AlphaBoard; AlphaBoard posts them to the channel and sends them to MT5; everything, crypto included, runs on MT5 for now. Crypto runs as broker CFDs (e.g. `SOLUSD.ec`) only if the heartbeat shows the broker lists them.

## Global Constraints
- **Claude never executes real-money trades.** The EA refuses a real account unless `InpAllowReal=true`, and `InpDryRun=true` is the default. Farjad sets both.
- **At most once.** A job is claimed once (PENDING → SENT in one conditional update) and never re-sent automatically. If a SENT job gets no report within 120 s, it becomes `UNKNOWN` and Farjad is alerted on his linked Telegram chat; nothing retries it.
- **Never round risk up.** If the risk-based volume is below the symbol's minimum lot, the job is REJECTED with `volume below min lot`.
- Risk per signal: default 0.5 %, hard cap 1.0 % (server validation and EA `InpRiskCapPct`). EA `InpMaxLot` defaults to 0.05, like GoldHedgeManager.
- A stop is mandatory on every signal: no stop, no signal. TPs are 0–4 and strictly ordered in the trade's direction.
- Slippage guard: when `entry` is set and |live price − entry| > `maxDeviation` (default: 25 % of the stop distance), the job is REJECTED with `price moved`. When the live price is already beyond the stop, it is REJECTED too.
- Signals expire: a PENDING job older than `expiresAt` (default 10 min after creation) becomes EXPIRED and is never executed.
- EA magic `880900` (GoldHedgeManager uses 880801 and enforces only magic 0, so it never closes copier trades). Order comment: `ab:<signalId>:<leg>`. Before opening, the EA checks open positions and today's history for that comment and does not open the same leg twice.
- Device tokens: 32 random bytes in base64url, shown once and stored only as a SHA-256 hash (`last4` kept for display). Revoked tokens are rejected.
- The channel is configured only by env: `SIGNAL_BOT_TOKEN` and `SIGNAL_CHANNEL_ID`. Dev and test never post to `-1004494875634`; they use a private test channel. Either env empty means the channel is off and execution still works.
- Execution never depends on Telegram. A failed channel post is stored in `channelError` and shown in the UI; the signal still executes.
- The Signal Desk is admin-only (`requireAdmin`). EA routes authenticate with the device token and are rate-limited.
- Public posts show prices and R multiples only, never account money. Each post ends with `Not financial advice.`
- Server-side times are UTC. The UI and copy are in English, like the rest of the app.

## Files
| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration `20261021000000_p12_signal_desk` | `Mt5Device`, `TradeSignal`, `TradeSignalLeg`, enums |
| `lib/signals/validate.ts` | Pure: zod input schema + `checkSignal()` (stop side, TP order, risk cap, symbol known) |
| `lib/signals/wire.ts` | Pure: `encodeJobs()` (server → EA lines), `parseReport()` (EA form body → typed event) |
| `lib/signals/state.ts` | Pure: `applyReport(signal, legs, event)` → next status, leg updates, channel reply text or null |
| `lib/signals/format.ts` | Pure: `formatSignalPost()`, `formatReply()` |
| `lib/signals/service.ts` | DB: `createSignal`, `claimJobs`, `recordReport`, `queueCommand`, `sweepSignals` |
| `lib/signals/channel.ts` | Channel posts and replies through `createTelegram(SIGNAL_BOT_TOKEN)` |
| `lib/mt5/devices.ts` | `createDevice` (returns the token once), `deviceFromRequest`, `revokeDevice`, `recordHeartbeat` |
| `lib/notify/telegram.ts` | `send()` gains `opts?: { replyTo?: number }` |
| `app/api/mt5/heartbeat/route.ts` | EA → server: login, server, trade mode, balance, currency, symbols |
| `app/api/mt5/signals/next/route.ts` | EA polls: claims PENDING jobs and pending commands, returns lines |
| `app/api/mt5/signals/[id]/report/route.ts` | EA → server events |
| `app/api/signal-desk/route.ts` | Admin: GET list, POST create (+ channel post) |
| `app/api/signal-desk/[id]/route.ts` | Admin: POST `{ command: "CLOSE_ALL" \| "BREAKEVEN" \| "CANCEL" }` |
| `app/api/signal-desk/devices/route.ts` | Admin: GET devices, POST create (token once), DELETE revoke |
| `app/signal-desk/page.tsx`, `components/signal-desk/*` | Form, live list, device card |
| `auth.config.ts` | `/api/mt5/` is public at the proxy; the routes authenticate themselves |
| `lib/jobs/tick.ts` | Calls `sweepSignals(now)` (expire + UNKNOWN + alert) |
| `mql5/SignalCopier.mq5` | The EA |
| `.env.example`, `docs/HANDOFF.md`, changelog | Env, runbook |

## Data model

```prisma
enum TradeSignalStatus { PENDING SENT OPEN CLOSED REJECTED EXPIRED CANCELLED UNKNOWN }
enum SignalLegStatus   { OPEN TP SL CLOSED }

/// A terminal running SignalCopier.mq5 (P12). Authenticates with a bearer token stored only as a SHA-256 hash.
model Mt5Device {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  label       String
  tokenHash   String    @unique
  last4       String
  /// Filled by the heartbeat.
  login       String?
  server      String?
  tradeMode   String?   // "DEMO" | "REAL" | "CONTEST"
  balance     Float?
  currency    String?
  symbols     String[]  @default([])
  lastSeenAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  signals TradeSignal[]
  @@index([userId])
}

/// A trade signal written in the Signal Desk (P12): posted to the channel and/or executed by SignalCopier.
model TradeSignal {
  id                String            @id @default(cuid())
  userId            String
  user              User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// Broker symbol as listed by the device heartbeat, e.g. "XAUUSD.ec".
  symbol            String
  side              String            // "BUY" | "SELL"
  /// Reference price for the post and the slippage guard; null = market now.
  entry             Float?
  stop              Float
  tps               Float[]
  riskPct           Float
  maxDeviation      Float?
  note              String?
  execute           Boolean
  post              Boolean
  status            TradeSignalStatus @default(PENDING)
  statusReason      String?
  deviceId          String?
  device            Mt5Device?        @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  sentAt            DateTime?
  expiresAt         DateTime
  /// "CLOSE_ALL" | "BREAKEVEN" queued for the EA; cleared when it is sent.
  pendingCommand    String?
  channelMessageId  Int?
  channelError      String?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  legs TradeSignalLeg[]
  @@index([userId, createdAt])
  @@index([status, expiresAt])
}

model TradeSignalLeg {
  id         String          @id @default(cuid())
  signalId   String
  signal     TradeSignal     @relation(fields: [signalId], references: [id], onDelete: Cascade)
  leg        Int             // 1-based; matches the order comment
  ticket     String
  volume     Float
  openPrice  Float
  tp         Float?
  status     SignalLegStatus @default(OPEN)
  closePrice Float?
  /// Result in R: (close − open) / |open − stop|, signed for the side.
  r          Float?
  closedAt   DateTime?

  @@unique([signalId, leg])
}
```
`User` gets `mt5Devices Mt5Device[]` and `tradeSignals TradeSignal[]`.

## Wire protocol (EA ⇄ server)

`GET /api/mt5/signals/next` → `text/plain`, one job per line, `|`-separated, numbers with `.`:
```
OPEN|<id>|<symbol>|<BUY|SELL>|<entry or ->|<stop>|<maxDev or ->|<riskPct>|<tp1,tp2,... or ->
CMD|<id>|<CLOSE_ALL|BREAKEVEN>
```
Empty body = nothing to do. Every call also counts as a heartbeat (`lastSeenAt`).

`POST /api/mt5/signals/:id/report`, `application/x-www-form-urlencoded`:
```
event=FILLED&leg=1&ticket=123&volume=0.02&price=2650.4&tp=2656
event=REJECTED&reason=price%20moved
event=DRY_RUN&reason=lots%3D0.04%20legs%3D3
event=TP&leg=1&price=2656.0
event=SL&leg=2&price=2638.0
event=CLOSED&leg=3&price=2649.1          (manual or CLOSE_ALL)
event=BE&price=2650.4                    (stops moved to entry)
```

`POST /api/mt5/heartbeat`, form body: `login, server, mode (DEMO|REAL|CONTEST), balance, currency, symbols` (comma list of Market Watch symbols).

## Tasks

### Task 1: Schema + pure validation
**Files:** schema + migration; `lib/signals/validate.ts`; `tests/unit/signalValidate.test.ts`

**Produces:** `signalInput` (zod), `type SignalInput`, `checkSignal(input, { symbols: string[] }): string[]` (empty array = valid).

- [ ] Write the failing tests:
```ts
import { describe, it, expect } from "vitest";
import { checkSignal, signalInput } from "@/lib/signals/validate";

const base = { symbol: "XAUUSD.ec", side: "BUY", entry: 2650, stop: 2638, tps: [2656, 2662], riskPct: 0.5, execute: true, post: true };
const ctx = { symbols: ["XAUUSD.ec", "SOLUSD.ec"] };

describe("checkSignal", () => {
  it("accepts a valid long", () => expect(checkSignal(signalInput.parse(base), ctx)).toEqual([]));
  it("needs the stop below a long's entry", () =>
    expect(checkSignal(signalInput.parse({ ...base, stop: 2660 }), ctx)).toContain("stop must be below entry for a BUY"));
  it("needs the stop above a short's entry", () =>
    expect(checkSignal(signalInput.parse({ ...base, side: "SELL", tps: [2640] }), ctx)).toContain("stop must be above entry for a SELL"));
  it("needs TPs ordered away from entry", () =>
    expect(checkSignal(signalInput.parse({ ...base, tps: [2662, 2656] }), ctx)).toContain("TPs must move away from entry in order"));
  it("caps risk at 1%", () => expect(() => signalInput.parse({ ...base, riskPct: 1.5 })).toThrow());
  it("allows at most 4 TPs", () => expect(() => signalInput.parse({ ...base, tps: [1, 2, 3, 4, 5] })).toThrow());
  it("rejects a symbol the terminal does not list when executing", () =>
    expect(checkSignal(signalInput.parse({ ...base, symbol: "BTCUSD.ec" }), ctx)).toContain("BTCUSD.ec is not in the terminal's symbol list"));
  it("lets a channel-only signal use any symbol", () =>
    expect(checkSignal(signalInput.parse({ ...base, symbol: "BTCUSD.ec", execute: false }), ctx)).toEqual([]));
  it("needs entry for a channel-only signal", () =>
    expect(checkSignal(signalInput.parse({ ...base, entry: null, execute: false }), ctx)).toContain("entry is required when the signal is not executed"));
  it("needs execute or post", () =>
    expect(checkSignal(signalInput.parse({ ...base, execute: false, post: false }), ctx)).toContain("choose post, execute or both"));
});
```
- [ ] Run `npx vitest run tests/unit/signalValidate.test.ts` → FAIL (module missing).
- [ ] Implement:
```ts
import { z } from "zod";

export const signalInput = z.object({
  symbol: z.string().trim().min(1).max(32),
  side: z.enum(["BUY", "SELL"]),
  entry: z.number().positive().nullable().default(null),
  stop: z.number().positive(),
  tps: z.array(z.number().positive()).max(4).default([]),
  riskPct: z.number().positive().max(1).default(0.5),
  maxDeviation: z.number().positive().nullable().default(null),
  note: z.string().trim().max(280).nullable().default(null),
  execute: z.boolean(),
  post: z.boolean(),
});
export type SignalInput = z.infer<typeof signalInput>;

/** Rule violations as user-facing strings; [] when the signal is valid. Prices are checked against `entry` when given. */
export function checkSignal(s: SignalInput, ctx: { symbols: string[] }): string[] {
  const errs: string[] = [];
  const dir = s.side === "BUY" ? 1 : -1;
  if (!s.execute && !s.post) errs.push("choose post, execute or both");
  if (!s.execute && s.entry == null) errs.push("entry is required when the signal is not executed");
  if (s.execute && !ctx.symbols.includes(s.symbol)) errs.push(`${s.symbol} is not in the terminal's symbol list`);
  const ref = s.entry;
  if (ref != null && (s.stop - ref) * dir >= 0) errs.push(`stop must be ${dir > 0 ? "below" : "above"} entry for a ${s.side}`);
  const chain = ref != null ? [ref, ...s.tps] : s.tps;
  for (let i = 1; i < chain.length; i++) if ((chain[i] - chain[i - 1]) * dir <= 0) { errs.push("TPs must move away from entry in order"); break; }
  if (ref == null && s.tps.length && (s.tps[0] - s.stop) * dir <= 0) errs.push("TPs must be on the profit side of the stop");
  return errs;
}
```
- [ ] Add the Prisma models above + `User` relations, run `npx prisma migrate dev --name p12_signal_desk` against the dev DB (port 5434), rename the folder to `20261021000000_p12_signal_desk` if needed.
- [ ] Tests pass; `npm run typecheck`; commit `feat(signals): signal model and validation`.

### Task 2: Wire protocol + state machine (pure)
**Files:** `lib/signals/wire.ts`, `lib/signals/state.ts`; `tests/unit/signalWire.test.ts`, `tests/unit/signalState.test.ts`

**Produces:**
```ts
// wire.ts
export type Job =
  | { kind: "OPEN"; id: string; symbol: string; side: "BUY" | "SELL"; entry: number | null; stop: number; maxDeviation: number | null; riskPct: number; tps: number[] }
  | { kind: "CMD"; id: string; command: "CLOSE_ALL" | "BREAKEVEN" };
export function encodeJobs(jobs: Job[]): string;
export type ReportEvent =
  | { event: "FILLED"; leg: number; ticket: string; volume: number; price: number; tp: number | null }
  | { event: "TP" | "SL" | "CLOSED"; leg: number; price: number }
  | { event: "BE"; price: number }
  | { event: "REJECTED" | "DRY_RUN"; reason: string };
export function parseReport(body: URLSearchParams): ReportEvent; // throws HttpError 400 on bad input

// state.ts
export interface LegView { leg: number; status: "OPEN" | "TP" | "SL" | "CLOSED"; openPrice: number; tp: number | null }
export interface SignalView { status: string; side: "BUY" | "SELL"; stop: number; tps: number[]; legs: LegView[] }
export interface Transition {
  status: string;            // next TradeSignal status
  reason?: string;
  legUpdate?: { leg: number; status: "TP" | "SL" | "CLOSED"; closePrice: number; r: number };
  reply: string | null;      // channel reply text, null = no post
}
export function applyReport(s: SignalView, e: ReportEvent): Transition;
```
- [ ] Failing tests, wire: `encodeJobs` yields exactly `OPEN|s1|XAUUSD.ec|BUY|2650.4|2638|-|0.5|2656,2662` and `CMD|s1|BREAKEVEN`, with `-` for nulls and no float noise (`0.1+0.2` is printed as `0.3`, via `Number(x.toPrecision(10))`); `parseReport` parses each event example from the protocol section and rejects an unknown event, `leg=0` and a non-numeric price.
- [ ] Failing tests, state:
  - SENT + FILLED leg 1 → OPEN, no reply (the post already went out).
  - SENT + REJECTED → REJECTED with the reason, no reply.
  - SENT + DRY_RUN → CLOSED with reason `dry run: …`, no reply.
  - OPEN + TP on leg 1 of 3 → stays OPEN; leg r = (2656−2650)/12 = 0.5; reply `🎯 TP1 reached 2656 (+0.5R)`.
  - The last open leg hits TP → CLOSED; reply `🏁 All targets reached`.
  - SL on a leg whose stop was moved to entry (r ≈ 0) → reply `⚖️ Stopped at entry (0R)`; at the original stop → `🛑 Stop hit (−1R)`.
  - BE → OPEN; reply `🔒 Stop moved to entry`.
  - CLOSED (manual) → reply `✅ Closed at 2649.1 (−0.1R)` when it is the last leg.
  - An event for a leg that is already final → same status, no update, reply null (idempotent re-report).
- [ ] Implement both modules to pass. R uses the signal's original `stop` for the denominator: `r = (close − open) * dir / |open − stop|`, rounded to 2 decimals.
- [ ] Tests pass; commit `feat(signals): EA wire protocol and signal state machine`.

### Task 3: Channel formatting + Telegram reply support
**Files:** `lib/signals/format.ts`, `lib/signals/channel.ts`, `lib/notify/telegram.ts`; `tests/unit/signalFormat.test.ts`, `tests/unit/alertsTelegram.test.ts` (extend)

**Produces:** `formatSignalPost(s: { symbol; side; entry; stop; tps; riskPct; note }): string`, `channelFromEnv(): { post(text): Promise<number>; reply(messageId, text): Promise<number> } | null`. `Telegram.send(chatId, text, keyboard?, opts?: { replyTo?: number })`.

- [ ] Failing test, exact text for a gold long. The broker suffix is stripped for display (`XAUUSD.ec` → `XAUUSD`):
```
🟢 LONG XAUUSD
Entry 2650.4
Stop 2638 (−12.4)
🎯 TP1 2656 · TP2 2662
R:R to TP1 0.45 · risk 0.5%
<note line when present>
#XAUUSD
Not financial advice.
```
  Short = `🔴 SHORT`. A market signal (entry null) shows `Entry market`, with no stop distance and no R:R.
- [ ] Failing test: `createTelegram(...).send("c", "t", undefined, { replyTo: 7 })` posts body with `reply_parameters: { message_id: 7, allow_sending_without_reply: true }`; without opts the body is unchanged (existing tests stay green).
- [ ] Implement. `channelFromEnv` returns null unless both `SIGNAL_BOT_TOKEN` and `SIGNAL_CHANNEL_ID` are set. It reuses `createTelegram` and is never `telegramFromEnv`: that is a different bot and is long-polled by the worker.
- [ ] Commit `feat(signals): channel post format and reply support`.

### Task 4: Devices + EA endpoints (DB TDD)
**Files:** `lib/mt5/devices.ts`, `lib/signals/service.ts` (claim + report part), `app/api/mt5/heartbeat/route.ts`, `app/api/mt5/signals/next/route.ts`, `app/api/mt5/signals/[id]/report/route.ts`, `auth.config.ts`; `tests/db/signalDesk.test.ts`

**Produces:**
```ts
// devices.ts
export async function createDevice(userId: string, label: string): Promise<{ device: Mt5Device; token: string }>;
export async function deviceFromRequest(req: Request): Promise<Mt5Device>;  // 401 on missing/unknown/revoked; updates lastSeenAt
export async function revokeDevice(userId: string, id: string): Promise<void>;
export async function recordHeartbeat(device: Mt5Device, form: URLSearchParams): Promise<void>;
// service.ts
export async function claimJobs(device: Mt5Device, now?: Date): Promise<Job[]>;
export async function recordReport(device: Mt5Device, signalId: string, e: ReportEvent): Promise<void>;
```
- [ ] Failing db tests (`npm run test:db`):
  - token round trip; a revoked or wrong token → 401; the token is not stored in clear (`tokenHash` ≠ token).
  - `claimJobs` returns a PENDING, unexpired, `execute: true` signal of the same user, sets SENT + `sentAt` + `deviceId`; a second call returns nothing.
  - Two concurrent `claimJobs` calls (`Promise.all`) → exactly one gets the job (claim = `updateMany({ where: { id, status: "PENDING" } })` and keep only rows with count 1).
  - Expired, channel-only or other users' signals are never claimed.
  - `pendingCommand` is returned once as a CMD job and cleared.
  - `recordReport` from another user's device → 404; FILLED creates the leg; TP updates the leg and posts the reply (inject a fake channel); a duplicate TP report changes nothing and posts nothing.
- [ ] Implement. Routes use `route()` + `enforceRateLimit(req, "api")` + `deviceFromRequest`; `next` returns `new Response(encodeJobs(jobs), { headers: { "content-type": "text/plain; charset=utf-8" } })`. In `auth.config.ts`, `isPublicPath` gets `if (pathname.startsWith("/api/mt5/")) return true; // EA routes authenticate with a device token`. Add a unit case to the existing `isPublicPath` tests if present.
- [ ] Commit `feat(mt5): device tokens and EA endpoints for the Signal Desk`.

### Task 5: Create, commands, sweep (DB TDD)
**Files:** `lib/signals/service.ts` (rest), `app/api/signal-desk/route.ts`, `app/api/signal-desk/[id]/route.ts`, `app/api/signal-desk/devices/route.ts`, `lib/jobs/tick.ts`; `tests/db/signalDesk.test.ts` (extend)

**Produces:** `createSignal(userId, input, deps?: { channel?, now? })`, `queueCommand(userId, id, command)`, `sweepSignals(now, deps?: { alert? })`.

- [ ] Failing db tests:
  - `createSignal` with `post` posts once and stores `channelMessageId`; a channel that throws stores `channelError` and the signal is still PENDING; `post:false` posts nothing; `execute:false` stores status CLOSED with reason `channel only`, so it is never claimed.
  - Executing needs a device of that user seen within 60 s, or the response warns `terminal offline; the signal expires at HH:MM UTC` (created anyway).
  - `queueCommand("CANCEL")` on PENDING → CANCELLED; on SENT/OPEN → 409 `already sent; use CLOSE_ALL`. `CLOSE_ALL`/`BREAKEVEN` only on OPEN.
  - `sweepSignals`: PENDING past `expiresAt` → EXPIRED; SENT for more than 120 s without a FILLED/REJECTED/DRY_RUN → UNKNOWN + one alert to the owner's linked chat (`telegramFromEnv`), and no second alert on the next sweep.
- [ ] Implement routes with `requireAdmin()`; POST create returns `{ signal, warnings }`; devices POST returns the token once with `cache-control: no-store`. Hook `sweepSignals` into `runTick` with its errors appended to `errors` like the other steps.
- [ ] Commit `feat(signals): signal desk API, commands and expiry sweep`.

### Task 6: Signal Desk page
**Files:** `app/signal-desk/page.tsx`, `components/signal-desk/SignalForm.tsx`, `SignalList.tsx`, `DeviceCard.tsx`, nav entry for admins.

- [ ] Device card: label, account login, DEMO/REAL badge (REAL in the danger token), balance, last seen ("online" < 60 s), symbol count, "New token" (shows the token once with copy + the WebRequest URL to whitelist), revoke.
- [ ] Form: symbol select from the device's symbols (free text when execute is off), side toggle, entry (blank = market), stop, up to 4 TPs, risk % (0.5 default, max 1), toggles "Post to channel" / "Execute on MT5", a live preview of the exact channel text (`formatSignalPost`), and an R:R readout. Submit is disabled while `checkSignal` returns errors, and the errors show inline.
- [ ] List: newest first, polls every 5 s; status chip, legs with R, channel link `https://t.me/gheymat_today/<messageId>`, buttons Cancel / Breakeven / Close all (with confirm), and channel errors in plain words.
- [ ] Follow the design system memory (light tokens, no nested cards, Tailwind only). Run `/impeccable audit` on the page. Verify in the browser pane on dev against a fake device made with `curl` (heartbeat + next + report), no MT5 needed.
- [ ] Commit `feat(signals): Signal Desk page`.

### Task 7: SignalCopier.mq5
**Files:** `mql5/SignalCopier.mq5`

Inputs:
```
input string InpBaseUrl     = "https://<railway-domain>";   // must also be in Tools → Options → Expert Advisors → WebRequest
input string InpToken       = "";
input bool   InpDryRun      = true;    // log + report DRY_RUN, open nothing
input bool   InpAllowReal   = false;   // refuse a REAL account unless true
input double InpRiskCapPct  = 1.0;
input double InpMaxLot      = 0.05;    // total across legs
input int    InpPollSec     = 3;
input bool   InpBEAfterTP1  = true;    // move remaining legs' stop to entry after TP1
input ulong  InpMagic       = 880900;
```
Behaviour:
- `OnInit`: refuse to start (INIT_FAILED with a clear Print) if the token is empty, or if `ACCOUNT_TRADE_MODE == ACCOUNT_TRADE_MODE_REAL && !InpAllowReal`. `EventSetTimer(InpPollSec)`. Send the heartbeat (all `SymbolsTotal(true)` names).
- `OnTimer`: heartbeat every 30 s; `GET next`. For each line:
  - `OPEN`:
    1. `SymbolSelect`.
    2. Price checks: price beyond the stop → REJECTED `price beyond stop`; slippage guard → REJECTED `price moved`.
    3. Volume: `riskMoney = balance * min(riskPct, InpRiskCapPct) / 100`; `lossPerLot = |price − stop| / SYMBOL_TRADE_TICK_SIZE * SYMBOL_TRADE_TICK_VALUE_LOSS`; `lots = floor(riskMoney / lossPerLot / step) * step`, capped at `InpMaxLot`. Below `SYMBOL_VOLUME_MIN` → REJECTED `volume below min lot`.
    4. Legs: `n = max(1, tps count)`. While `n > 1` and `lots / n < min lot`, decrease `n` and keep the first `n` TPs. Each leg gets `floor(lots / n / step) * step`, and the remainder goes to leg 1.
    5. Duplicate check by comment `ab:<id>:<leg>`, then `trade.Buy/Sell(vol, sym, 0, stop, tp, comment)` per leg, and FILLED per leg with the deal price. With `InpDryRun`, nothing opens: one DRY_RUN report says `lots=… legs=… tps=…`.
  - `CMD BREAKEVEN`: `PositionModify` every open leg's SL to its open price, then BE.
  - `CMD CLOSE_ALL`: `PositionClose` every open leg, and a CLOSED report per leg comes from `OnTradeTransaction`.
- `OnTradeTransaction`: on `DEAL_ENTRY_OUT` for magic 880900, read the position's comment through `HistorySelectByPosition` and the opening deal. `DEAL_REASON_TP` → TP, `DEAL_REASON_SL` → SL, anything else → CLOSED. After a TP on leg 1 with `InpBEAfterTP1`, move the other open legs to BE and report BE.
- Reports that fail (`WebRequest` −1 or HTTP ≥ 500) go to an in-memory queue retried on each timer tick (max 50). A report is safe to repeat, because the server ignores duplicates (Task 2).
- `WebRequest` errors 4014 (URL not allowed) print the exact whitelist instruction.
- [ ] Compile with the Wine MetaEditor CLI (recipe in memory `mt5-expert-advisors`) to 0 errors / 0 warnings, and copy it to `MQL5/Experts`.
- [ ] Commit `feat(mt5): SignalCopier expert`.

### Task 8: End-to-end on a demo account, docs, deploy
- [ ] Farjad opens an MT5 **demo** account (ePlanet demo, or MetaQuotes-Demo if ePlanet has none) in the same terminal. Claude does not create accounts.
- [ ] Dev: a private test channel + `SIGNAL_CHANNEL_ID` pointing at it; dev AlphaBoard exposed to the terminal through `http://localhost:3001`. The Wine terminal reaches the host's localhost; if it does not, use the Railway preview after deploy.
- [ ] Runs, each checked in the terminal, in the DB and in the test channel:
  1. Dry run gold long with 3 TPs → DRY_RUN with lots/legs.
  2. Live-on-demo gold long with 3 TPs → 3 positions, magic 880900, comments `ab:<id>:1..3`, SL/TP set at the broker.
  3. TP1 hit (use a TP near the price) → reply in the channel, other legs moved to entry.
  4. Close all from the page → CLOSED replies.
  5. Slippage reject.
  6. Expiry with the EA stopped.
  7. UNKNOWN after killing the network mid-claim (stop the EA right after claim).
  8. A short on a crypto CFD if the heartbeat lists one.
- [ ] `npm run lint && npm run typecheck && npm test && npm run test:db`; production image test on an empty DB (recipe in memory `alphaboard-dev-environment`).
- [ ] `.env.example`: `SIGNAL_BOT_TOKEN=""`, `SIGNAL_CHANNEL_ID=""` with comments. `docs/HANDOFF.md`: a Signal Desk runbook (token, whitelist, demo → real switch, what UNKNOWN means). Changelog entry.
- [ ] Push `v2`, open the PR v2 → main; Farjad merges and sets `SIGNAL_BOT_TOKEN` (@gheymattoday_bot) and `SIGNAL_CHANNEL_ID=-1004494875634` on Railway.
- [ ] **Farjad's switch to real money:** on the real account, `InpAllowReal=true`, `InpDryRun=false`, risk 0.5 %, gold first. Claude does not flip these.

## Out of scope (later, if needed)
- Pending/limit entries. The P10 note "non-market orders" still applies; v1 is market with a slippage guard.
- Price-watching TP posts for channel-only signals; those signals get no follow-ups in v1.
- Parsing messages written in Telegram by hand.
- Several terminals copying one signal (the claim is per signal; fan-out would need a claim per device).
- Journal rows for copier trades: the ExportDeals import already picks them up, and magic 880900 separates them in the edge check.
