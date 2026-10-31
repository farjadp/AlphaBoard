# P11 · Honest Numbers, Money Management and the Strategy Lab — Technical & Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn what the 2026-10-20 research showed into product: (P11a) money-management guards and a drawdown that counts open positions, (P11b) a Strategy Lab that backtests a rule honestly before real money touches it, (P11c) an MT5 bridge so manual, EA and agent trades are measured the same way.

**Architecture:** P11a extends the existing deterministic risk engine (`lib/risk/verdict.ts`) and session monitor/report; no new services. P11b adds a pure TypeScript simulation library (`lib/lab/*`) that runs as a queued job in the existing leased worker, with datasets stored in Postgres. P11c adds an importer for MT5 history reports into `JournalEntry` and an "edge check" that compares real trades against the Lab's random-entry baseline.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before any route/page work), TypeScript, Prisma/Postgres, Vitest, zod.

**Spec:** this document (research basis below). Product spec of record: `docs/superpowers/specs/2026-09-27-alphaboard-v2-design.md`; sessions spec `docs/superpowers/specs/2026-09-28-p8-agent-trading-sessions-design.md`.

## Research basis (2026-10-20, all on real data)

1. **Entries are close to a coin flip.** On 12 months of Farjad's own broker M1 data (ePlanet, XAUUSD/GBPNZD/EURUSD/EURGBP, ~42k simulated sets each), price came back to a first entry after a −1-candle move only 36–38 % of the time (random walk = 38 %). The "80 %" averaging rule had no edge; the second position never helped in 80 parameter combinations.
2. **Money management decides the outcome, but cannot rescue a negative edge.** Gold, no P2, H4 trend filter, random entries, 0.5 % risk: +6 %/yr with fixed risk; **+17 %/yr, 29/30 runs positive, max DD 10 %** with *stop after 2 losses in a row + daily loss lock 2 % + 30-min cooldown after a loss*. Splitting risk across **3 concurrent slots** kept the return (+15 %) and cut max DD to **6 %, 30/30 positive**. Martingale was the worst everywhere. On the three FX pairs no money-management rule turned a loss into a profit (spread vs. 15-min distances).
3. **Realized-only P&L hides the truth.** An independent replay of a friend's crypto DCA bot ("Robi": long-only, buy after −3 %, ladder at −9 %/−19.5 %, +1–1.5 % TP, no stop) on 129 Binance futures symbols 2021-01 → 2026-09 reproduced his own depth statistics (86/11/2.6 % vs his 87/10/2.7 %) and showed **+440 % in 2021, −82 % in 2022, −75 % in 2025, max drawdown 95 %** — while the realized-only drawdown stayed at **3–8 %**. AlphaBoard's own session report has the same blind spot today: `computeMetrics` builds `maxDrawdown` from closed trades only.

## Global Constraints

- Every number shown to a user is computed in code from real data; nothing fabricated; "unavailable" when a value cannot be computed (project rule).
- Risk-engine changes are deterministic and every rejection carries a human-readable reason posted in the room.
- Exits (CLOSE, TIGHTEN_STOP) are never blocked by entry guards.
- TDD: failing test first; DB behaviour in `tests/db/*` (`npm run test:db`, needs `TEST_DATABASE_URL`).
- Migrations through `prisma migrate diff` + `migrate deploy` (see HANDOFF "Gotcha"), one migration per phase where possible.
- Claude never places or closes real-money trades; Farjad starts live sessions.
- Branch per phase from `v2`; Farjad merges to `main`.

---

## Phase map

| Phase | Deliverable | Size | Depends on |
|---|---|---|---|
| **P11a** | Money-management guards in sessions + mark-to-market drawdown in monitor and report | S (1 day) | — |
| **P11b-1** | Lab engine library (`lib/lab`): datasets, set simulators, account/MM layer, robustness, metrics — pure + tested, golden-checked against the Python research | M | — |
| **P11b-2** | Lab data: Binance klines history, OANDA candles history, MT5 CSV upload (`ExportM1.mq5` format); `LabDataset` storage | M | P11b-1 |
| **P11b-3** | Lab runs: `LabRun` job in the worker, API, `/lab` page with plain-language verdict, MTM vs realized curves, per-year table | M | P11b-1/2 |
| **P11c** | MT5 bridge: import MT5 history report (HTML/XLSX) into the journal + "edge check" against the Lab baseline; later an EA → API push | M | P11b |
| side | GoldHedgeManager 1.22: max concurrent sets + risk split (already validated) | S | — |

P11a is fully specified below and is implemented first. P11b/P11c get their own detailed plans (`2026-10-2x-p11b-…`, `…-p11c-…`) written when P11a ships; the architecture and acceptance criteria are fixed here so those plans cannot drift.

---

## P11a · Money-management guards + honest drawdown

### File structure

- Create `lib/risk/streak.ts` — pure: losing streak and last loss time from closed positions (UTC day scoped).
- Modify `lib/sessions/mandate.ts` — `maxConsecLosses`, `lossCooldownMin`.
- Modify `lib/risk/verdict.ts` — `RiskState.lossStreak`, `RiskState.lastLossAt`; two entry guards.
- Modify `lib/sessions/cycle.ts` (`riskState`) — fill the new fields; add them to the agents' usage context.
- Modify `prisma/schema.prisma` + migration — `TradingSession.equityPeak Float?`, `TradingSession.maxDrawdownMtm Float @default(0)`.
- Create `lib/sessions/drawdown.ts` — pure: next peak / max drawdown from an equity sample.
- Modify `lib/sessions/monitor.ts` — after the loss-limit check, persist peak/max DD when it changes.
- Modify `lib/sessions/report.ts` + `lib/types/sessions.ts` — `maxDrawdownMtm` and the wording that tells both drawdowns apart.
- Modify `components/sessions/MandateForm.tsx` — two inputs; and the report view to show both drawdowns.
- Tests: `tests/unit/riskStreak.test.ts`, `tests/unit/riskEngine.test.ts`, `tests/unit/sessionMandate.test.ts`, `tests/unit/sessionDrawdown.test.ts`, `tests/unit/sessionReport.test.ts`.

### Task 1: Losing streak (pure)

**Files:** Create `lib/risk/streak.ts`; Test `tests/unit/riskStreak.test.ts`

**Interfaces — Produces:**
`export interface ClosedResult { closedAt: number; pnl: number }`
`export function lossStreak(closed: ClosedResult[], now: number): { streak: number; lastLossAt: number | null }`
— streak = trailing count of `pnl < 0` among positions closed since 00:00 UTC of `now`, ordered by `closedAt`; any `pnl >= 0` resets it. `lastLossAt` = latest losing `closedAt` of any day (cooldowns span midnight).

- [ ] Step 1 — failing test:

```ts
import { describe, it, expect } from "vitest";
import { lossStreak } from "@/lib/risk/streak";

const DAY = Date.UTC(2026, 9, 20);
const at = (h: number, m = 0) => DAY + h * 3_600_000 + m * 60_000;

describe("lossStreak", () => {
  it("counts trailing losses of the UTC day, a win resets", () => {
    const r = lossStreak([{ closedAt: at(9), pnl: -5 }, { closedAt: at(10), pnl: 3 }, { closedAt: at(11), pnl: -2 }, { closedAt: at(12), pnl: -1 }], at(13));
    expect(r).toEqual({ streak: 2, lastLossAt: at(12) });
  });
  it("ignores order of input", () => {
    expect(lossStreak([{ closedAt: at(12), pnl: -1 }, { closedAt: at(11), pnl: -2 }, { closedAt: at(10), pnl: 3 }], at(13)).streak).toBe(2);
  });
  it("resets the streak at UTC midnight but keeps lastLossAt for cooldowns", () => {
    const r = lossStreak([{ closedAt: DAY - 60_000, pnl: -4 }, { closedAt: DAY - 30_000, pnl: -4 }], at(0, 5));
    expect(r).toEqual({ streak: 0, lastLossAt: DAY - 30_000 });
  });
  it("breakeven (0) is not a loss", () => {
    expect(lossStreak([{ closedAt: at(9), pnl: -1 }, { closedAt: at(10), pnl: 0 }], at(11)).streak).toBe(0);
  });
  it("empty → 0 / null", () => expect(lossStreak([], at(1))).toEqual({ streak: 0, lastLossAt: null }));
});
```

- [ ] Step 2 — run `npx vitest run tests/unit/riskStreak.test.ts` → FAIL (module missing).
- [ ] Step 3 — implement:

```ts
/** Losing-streak facts for the money-management guards (pure). */
export interface ClosedResult { closedAt: number; pnl: number }

const dayStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/** Trailing losses since 00:00 UTC (a result ≥ 0 resets), and the latest losing close of any day. */
export function lossStreak(closed: ClosedResult[], now: number): { streak: number; lastLossAt: number | null } {
  const sorted = [...closed].sort((a, b) => a.closedAt - b.closedAt);
  let lastLossAt: number | null = null;
  for (const c of sorted) if (c.pnl < 0) lastLossAt = c.closedAt;
  const since = dayStart(now);
  let streak = 0;
  for (const c of sorted) {
    if (c.closedAt < since) continue;
    streak = c.pnl < 0 ? streak + 1 : 0;
  }
  return { streak, lastLossAt };
}
```

- [ ] Step 4 — test passes. Step 5 — commit `feat(risk): losing streak facts for money-management guards`.

### Task 2: Mandate fields

**Files:** Modify `lib/sessions/mandate.ts`; Test `tests/unit/sessionMandate.test.ts`

**Produces:** `Mandate.maxConsecLosses: number` (0–10, default 2, 0 = off), `Mandate.lossCooldownMin: number` (0–1440, default 30, 0 = off). Existing `cooldownMin` keeps its meaning (same symbol after a stop-out).

- [ ] Step 1 — failing tests:

```ts
it("defaults the money-management guards", () => {
  const m = parseMandate({ symbols: ["BTC/USDT"], capital: 1_000 });
  expect(m.maxConsecLosses).toBe(2);
  expect(m.lossCooldownMin).toBe(30);
});
it("accepts 0 to turn the guards off and rejects out-of-range values", () => {
  expect(parseMandate({ symbols: ["BTC/USDT"], capital: 1_000, maxConsecLosses: 0, lossCooldownMin: 0 })).toMatchObject({ maxConsecLosses: 0, lossCooldownMin: 0 });
  expect(() => parseMandate({ symbols: ["BTC/USDT"], capital: 1_000, maxConsecLosses: 11 })).toThrow(/maxConsecLosses/);
});
```

- [ ] Step 2 — FAIL. Step 3 — add to `MandateSchema` after `cooldownMin`:

```ts
    /** Stop new entries for the rest of the UTC day after this many losing closes in a row (0 = off). */
    maxConsecLosses: z.number().int().min(0).max(10).default(2),
    /** No new entry on any symbol for this many minutes after a losing close (0 = off). */
    lossCooldownMin: z.number().int().min(0).max(1440).default(30),
```

- [ ] Step 4 — PASS (whole file). Step 5 — commit `feat(sessions): mandate money-management fields`.

### Task 3: Risk-engine guards

**Files:** Modify `lib/risk/verdict.ts`; Test `tests/unit/riskEngine.test.ts`

**Consumes:** Task 2 fields. **Produces:** `RiskState.lossStreak?: number`, `RiskState.lastLossAt?: number | null` (optional so existing callers/tests compile; absent = 0/null).

- [ ] Step 1 — failing tests (append):

```ts
describe("risk engine — money-management guards", () => {
  it("refuses entries after maxConsecLosses losses in a row", () => {
    const v = evaluateProposal(long(), spot, state({ lossStreak: 2 }), rules());
    expect(v.kind).toBe("rejected");
    expect(reasons(v)).toMatch(/2 losing trades in a row/);
  });
  it("allows entries below the streak limit and when the guard is off", () => {
    expect(evaluateProposal(long(), spot, state({ lossStreak: 1 }), rules()).kind).toBe("approved");
    const off = parseMandate({ symbols: ["BTC/USDT"], capital: 1_000, maxConsecLosses: 0 });
    expect(evaluateProposal(long(), off, state({ lossStreak: 5 }), rules()).kind).toBe("approved");
  });
  it("refuses entries inside the loss cooldown on every symbol", () => {
    const v = evaluateProposal(long({ symbol: "ETH/USDT" }), spot, state({ lastLossAt: NOW - 10 * 60_000 }), rules());
    expect(v.kind).toBe("rejected");
    expect(reasons(v)).toMatch(/after a losing trade \(20 min left\)/);
    expect(evaluateProposal(long(), spot, state({ lastLossAt: NOW - 31 * 60_000 }), rules()).kind).toBe("approved");
  });
  it("never blocks exits", () => {
    const pos = { id: "p1", symbol: "BTC/USDT", side: "LONG" as const, qty: 1, entryPrice: 100, stopLoss: 95, margin: 100 };
    const v = evaluateProposal({ ...long(), action: "CLOSE", positionId: "p1" }, spot, state({ lossStreak: 9, lastLossAt: NOW, openPositions: [pos] }), rules());
    expect(v.kind).toBe("close");
  });
});
```

- [ ] Step 2 — FAIL. Step 3 — in `RiskState` add:

```ts
  /** Losing closes in a row today (UTC) — lib/risk/streak.ts. Absent = 0. */
  lossStreak?: number;
  /** Epoch ms of the latest losing close; absent/null = none. */
  lastLossAt?: number | null;
```

and in the entry path, right after the daily-loss check:

```ts
  const streak = s.lossStreak ?? 0;
  if (m.maxConsecLosses > 0 && streak >= m.maxConsecLosses)
    return reject(`${streak} losing trades in a row today — no new entries until tomorrow (UTC); a losing streak is when the market is not doing what the setup expects`);
  if (m.lossCooldownMin > 0 && s.lastLossAt != null && s.now - s.lastLossAt < m.lossCooldownMin * 60_000) {
    const left = Math.ceil((m.lossCooldownMin * 60_000 - (s.now - s.lastLossAt)) / 60_000);
    return reject(`cooldown after a losing trade (${left} min left) — no entries on any symbol`);
  }
```

- [ ] Step 4 — PASS (whole riskEngine file). Step 5 — commit `feat(risk): stop after a losing streak and cool down after any loss`.

### Task 4: Feed the guards from the session

**Files:** Modify `lib/sessions/cycle.ts` (`riskState`, `buildContext` usage), `lib/agents/context.ts` usage type if it renders usage; Test: extend the existing DB cycle test (`tests/db/*session*`) with one case where two losing closed positions today make the next OPEN verdict `rejected` with the streak reason.

- [ ] In `riskState`: `const { streak, lastLossAt } = lossStreak(fresh.positions.filter((p) => p.closedAt && p.realizedPnl != null).map((p) => ({ closedAt: p.closedAt!.getTime(), pnl: p.realizedPnl! })), now.getTime());` and return `lossStreak: streak, lastLossAt`. (`realizedPnl` on a position is net of its fees — `lib/venues/paper.ts` closes with `gross − entryFeeShare − exitFee`.)
- [ ] Usage context: add `lossStreak` and `maxConsecLosses` so the strategist knows entries are closed and holds instead of burning a cycle.
- [ ] `npm run test:db` for the touched file; commit `feat(sessions): feed losing streak and loss cooldown into the risk state`.

### Task 5: Mark-to-market drawdown

**Files:** Create `lib/sessions/drawdown.ts`; Test `tests/unit/sessionDrawdown.test.ts`; schema + migration `20261020xxxxxx_session_mtm_drawdown`; Modify `lib/sessions/monitor.ts`.

**Produces:** `export function nextDrawdown(prev: { peak: number | null; maxDd: number }, equity: number): { peak: number; maxDd: number; changed: boolean }` — peak starts at the first equity sample (capital), `maxDd` is the largest `peak − equity` seen (account currency).

- [ ] Step 1 — failing test:

```ts
import { describe, it, expect } from "vitest";
import { nextDrawdown } from "@/lib/sessions/drawdown";

describe("nextDrawdown", () => {
  it("tracks the peak and the deepest fall from it", () => {
    let s = { peak: null as number | null, maxDd: 0 };
    for (const e of [100, 104, 97, 101, 110, 103]) s = nextDrawdown(s, e);
    expect(s).toMatchObject({ peak: 110, maxDd: 7 });
  });
  it("reports changed only when something moved", () => {
    expect(nextDrawdown({ peak: 100, maxDd: 3 }, 99).changed).toBe(false);
    expect(nextDrawdown({ peak: 100, maxDd: 3 }, 95).changed).toBe(true);
    expect(nextDrawdown({ peak: 100, maxDd: 3 }, 101).changed).toBe(true);
  });
});
```

- [ ] Step 3 — implement:

```ts
/** Mark-to-market drawdown (open positions included) — the number a realized-only curve hides. */
export function nextDrawdown(prev: { peak: number | null; maxDd: number }, equity: number) {
  const peak = prev.peak == null ? equity : Math.max(prev.peak, equity);
  const maxDd = Math.max(prev.maxDd, peak - equity);
  return { peak, maxDd, changed: peak !== prev.peak || maxDd !== prev.maxDd };
}
```

- [ ] Schema: on `TradingSession` add
  `/// Highest mark-to-market equity seen by the monitor (capital + realized − fees + unrealized).`
  `equityPeak Float?`
  `/// Deepest fall from equityPeak, account currency — counts open positions, unlike a realized-only curve.`
  `maxDrawdownMtm Float @default(0)`
  then generate the migration with the shadow-DB recipe and `prisma generate`.
- [ ] Monitor: after computing `money$` in step 3 (and only when `money$.equity != null`), `const d = nextDrawdown({ peak: current.equityPeak, maxDd: current.maxDrawdownMtm }, money$.equity); if (d.changed) await prisma.tradingSession.update({ where: { id: s.id }, data: { equityPeak: d.peak, maxDrawdownMtm: d.maxDd } });`
- [ ] DB test: a session with an open position whose mark falls 30 then recovers → after two monitor passes `maxDrawdownMtm ≈ 30 × qty` while no trade is closed. Commit `feat(sessions): mark-to-market drawdown in the monitor`.

### Task 6: Report shows both drawdowns

**Files:** Modify `lib/types/sessions.ts` (`SessionMetrics.maxDrawdownMtm: number | null`), `lib/sessions/report.ts` (`MetricsInput.maxDrawdownMtm?: number`, `computeMetrics`, `metricsText`), the report writer call site (pass `session.maxDrawdownMtm`), report UI component; Test `tests/unit/sessionReport.test.ts`.

- [ ] Failing test: `computeMetrics({ …, maxDrawdownMtm: 42 })` → `maxDrawdownMtm: 42`; absent → `null`; `metricsText` contains `max drawdown incl. open positions $42.00` and still the closed-trade figure, labelled `closed trades only`.
- [ ] Implement; UI: show "Max drawdown (open positions included)" first, "closed trades only" second and smaller, with a one-line hint when the two differ by more than 2×: "Most of the drawdown happened in positions that were still open."
- [ ] Commit `feat(sessions): report the drawdown with open positions included`.

### Task 7: Mandate form

**Files:** Modify `components/sessions/MandateForm.tsx`.

- [ ] Two numeric inputs next to the existing cooldown: "Stop after N losses in a row (0 = off)" and "Pause after any loss (min, 0 = off)", same validation ranges, help text in plain words. Verify in the running app (preview `npm start -- -p 3001` after `npm run build`): create a paper session, confirm the mandate JSON carries both values. Commit `feat(sessions): money-management inputs in the mandate form`.

### Task 8: Gates, docs, tracker

- [ ] `npx tsc --noEmit`, `npx eslint .`, `npm run test`, `npm run test:db`, `npm run build` — all green.
- [ ] Live check on paper: a session with `maxConsecLosses: 1` and a forced losing close (tight paper stop) → next cycle's verdict is rejected with the streak reason in the room; report shows both drawdowns.
- [ ] HANDOFF row for P11a, CHANGELOG line, Notion cards → Done, Persian log line.

### P11a acceptance

1. Two losing closes in a row today → every new entry is rejected with a plain reason; exits still work.
2. A losing close → no entry on any symbol for `lossCooldownMin`.
3. A session whose open position fell and recovered shows a non-zero "max drawdown (open positions included)" even with zero closed losses.
4. Sessions started before P11a keep working unchanged: their stored mandate has no guard fields, `mandateOf` only casts it, so both guards stay off for them (tested).

---

## P11b · Strategy Lab (architecture fixed here; detailed plan follows P11a)

**Why:** every idea in this research was killed or confirmed by a simulation in minutes. The product should let Farjad do that himself, with the honesty rules built in.

**Engine (`lib/lab/`, pure, no I/O):**
- `bars.ts` — `Bars { t: Float64Array; o; h; l; c; spread?: Float64Array }`, resample, median candle range (`unit`), H4 EMA50/200 trend aligned to the last completed H4 bar.
- `sets/ladder.ts` — the GoldHedgeManager set (P1, optional P2 at −k·unit, scenario A partial close + breakeven, scenario B return-to-entry), stop-first tie rule inside a bar, costs per position.
- `sets/dca.ts` — the DCA ladder (Robi family): entry on drop from N-bar high, ladder depths/sizes, TP over average, optional rescue, optional stop; multi-symbol slots with cap-100 budgets.
- `account.ts` — sequential account with money management: risk % of balance per set (worst case), slots + risk split, daily loss lock, stop after N losses in a row, cooldown, optional martingale (shown as a warning case), compounding on/off.
- `robust.ts` — run on K random halves of the entry list (seeded), report median / min / max / share positive.
- `metrics.ts` — final return, monthly geometric, **max DD mark-to-market and realized-only side by side**, per-year returns, win rate, profit factor, average win/loss, return-to-entry probability and the break-even probability it would need.
- Golden tests: small synthetic bar fixtures with hand-checked outcomes; an opt-in test (`LAB_GOLDEN_DIR`) that runs the real 12-month broker CSVs and must reproduce the research numbers within tolerance (gold base: −48 $/100 sets ±5; return-to-entry 37.4 % ±0.5 pp).

**Data (`lib/lab/data/*`, server-only):**
- Binance klines history (1h for years, 1m for weeks) paged by `startTime`, via the existing `data-api.binance.vision` host list.
- OANDA candles (`/v3/instruments/{instrument}/candles`, M1/M15/H1, bid/ask mid) through a stored OANDA connection — read-only use of Farjad's token, already authorised.
- MT5 CSV upload in the `ExportM1.mq5` format (`utc,open,high,low,close,spread_points,point`).
- Model `LabDataset { id, userId, symbol, source, timeframe, from, to, bars Int, blob Bytes (gzip), createdAt }`, size cap per user.

**Runs:** model `LabRun { id, userId, spec Json, status QUEUED|RUNNING|DONE|FAILED, result Json?, error?, createdAt, startedAt?, finishedAt? }`; worker loop (like the news job) takes one QUEUED run at a time; API `POST /api/lab/runs`, `GET /api/lab/runs/:id`, dataset upload route; rate-limited and owner-only like every route.

**UI `/lab`:** template picker (EA ladder / DCA ladder / baseline), symbol + dataset, parameters, money-management block; results: plain-language verdict first ("random entries + these rules made X % a year; worst run Y %; drawdown with open positions Z %"), MTM vs realized equity curves, per-year table, robustness band.

**Acceptance:** the four research tables (80 % rule, 80-config sweep, money-management table, Robi per-year) can be reproduced from the UI.

## P11c · MT5 bridge + edge check (architecture fixed here)

- Import MT5 "History → Report" (HTML and XLSX) → deals grouped by position id → `JournalEntry` rows with `pnlSource: "MT5"` and `legacyId = mt5:<login>:<positionId>` (idempotent re-import).
- Edge check page: for the imported trades of a symbol and period, compare their average result in R with the Lab's random-entry baseline under the same management. Verdict: "your entries beat random by X R per trade (n = …)" or "no measurable edge yet (n < 100)".
- Later (P11c-2): the EA posts closed deals to `POST /api/mt5/deals` with a per-user token (MT5 `WebRequest`, URL allow-list).

## Side track · GoldHedgeManager 1.22

- `InpMaxOpenSets` (default 3) and `InpRiskSplit` (risk % ÷ open-set limit) — the validated "3 slots" result. Buttons refuse a new set when the limit is reached; manual trades over the limit are closed when `InpEnforceManual` is on.

## Open questions for Farjad (answer any time; defaults in brackets)

1. Phase order after P11a: Lab first or MT5 bridge first? [Lab first]
2. OANDA candles for the Lab use your live token read-only — OK? [yes, as before]
3. Lab access: admin only at first, or every invited user? [admin only]
