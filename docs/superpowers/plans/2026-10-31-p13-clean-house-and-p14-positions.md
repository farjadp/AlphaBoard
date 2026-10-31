# P13 · Clean House + P14 · Positions — plan

_Date: 2026-10-31 · Branch: `feat/p13-clean-house` (from `main` @ 3d0be49) · Status: **approved 2026-10-31, P13a in progress**_

## Why not a rewrite

Audit on 2026-10-31 (`tsc`, ESLint, 458 unit tests, knip, two code audits):

- Build health is green: typecheck 0 errors, lint 0 problems, 458 tests pass (169 DB tests skipped without `TEST_DATABASE_URL`).
- Conventions already exist and are followed (route wrappers on all 76 routes, `HttpError`, `aiJson`, `lib/market` only for data).
- Production has been live since 2026-09-29 with 42 Prisma models and 26 migrations on a real database.

A rewrite would throw that away and reproduce it over months. The "clutter" is real but it is organisational, not structural rot. So: refactor in place, behind re-export shims, every phase shippable on its own, tests green at each step.

## What "cluttered" actually is (findings)

**Repo hygiene**
- 16 local branches: 13 are already merged into `main`; 3 worktrees (`alphaboard-cryptopanic`, `-quota-step`, `-vercel`) are stale; PR #4 (`fix/quota-step`) open since 2026-09-29.
- `v2` is 23 commits behind `main`. Since P12 all work merged feature → `main` directly, so `v2` no longer means anything. CI still runs on both.
- `package.json` name is still `tradeflow`.

**Docs lie about deploy**
- `docs/HANDOFF.md`, `README.md` (§ Deploying), `docs/security-rotation-2026-10-21.md` (untracked), `FEATURES.md` describe Railway / v1. Production is Vercel (web) + Fly (worker) + Neon.
- Railway env vars are still read: `lib/ops/overview.ts:59`, `app/api/health/route.ts:24`; `mql5/SignalCopier.mq5:32` defaults to `*.up.railway.app`.
- Three migration runners: `scripts/vercel-build.sh`, `docker-entrypoint.sh` (every Fly boot), `npm start`.

**Layout**
- Loose files at `lib/` root (`binance.ts` = formatters, `assetCatalog.ts` ≈ 50 importers, `candlestickPatterns.ts`, `chartPatterns.ts`, `format.ts`, `site.ts`, `prisma.ts`) and at `components/` root (`NavBar`, `AcademyUI`, `TradePostMortem`, `PatternMiniVisual`).
- Execution code in four folders (`exchanges`, `exec`, `venues`, `mt5`); notifications in three (`alerts`, `db/alerts`, `notify`); background work in three (`jobs`, `worker`, `ops`).
- "signals" means two things: archived AI analyses (`lib/db/signals.ts`, `Signal` model, `/api/signals`) and the Telegram/MT5 desk (`lib/signals/*`, `TradeSignal`, `/api/signal-desk`).
- `NavBar` imported by 13 pages instead of one layout.

**Duplication**
- R-multiple in 4 places (`lib/eval/evaluator.ts:75`, `lib/signals/state.ts:27`, `lib/lab/edge.ts:54`, `lib/sessions/excursion.ts:23`), side naming differs (BUY/SELL, LONG/SHORT, ±1).
- Number formatting (`pct`, `usd`, `money`, `fmt`) redefined ≈ 20 times.
- Symbol suffix-strip regex copied 3× in `lib/signals/*`.
- Binance host failover copied 3× (`market/candles.ts`, `market/quote.ts`, `lab/data/binance.ts`).
- PostMortem type defined 3×; `AnalysisResult` restates `AnalysisSchema`.

**Routes**
- No `adminRoute`: `requireAdmin()` hand-called in 24 routes, 9 admin routes skip `enforceRateLimit`.
- 3 signal-desk routes use raw `req.json()` (no size cap).
- 22 routes + 5 server pages import `prisma` directly (against the HANDOFF rule).
- `LIVE_TRADING_ENABLED` checked two different ways (`app/api/exchanges/route.ts:19` vs `lib/exchanges/connections.ts:10`).
- In-memory rate limiter is per instance, so on Vercel it is mostly ineffective (`lib/http/rateLimit.ts`).

**Oversized client pages** (all `"use client"`, fetch + state + markup in one file)
- `app/journal/page.tsx` 807 lines (16 `useState`), `components/admin/lab/LabWorkbench.tsx` 649 (43 `useState`), `app/academy/page.tsx` 519, `components/AcademyUI.tsx` 452, `components/sessions/SessionRoom.tsx` 374 (own `useNow` duplicating `lib/client/useNow.ts`), `app/setup/page.tsx` 250, `app/alerts/page.tsx` 221.

**Dead / unused**
- knip: 69 unused exports, 36 unused exported types, `tests/setup/serverOnly.ts`, devDeps `@types/bcryptjs`, `pino-pretty`.
- `app/api/cron/tick` unused (no Vercel cron; Fly worker ticks).
- Legacy v1 import spread over 5 files, still linked from the account menu.

## Positions today (three unrelated worlds)

| | Paper (`lib/paper`) | Sessions (`lib/sessions`) | MT5 (`SignalCopier.mq5` + `lib/signals`) |
|---|---|---|---|
| Model | `PaperPosition` | `SessionPosition` (+`exitPlan` JSON, best/worst) | `TradeSignal` + `TradeSignalLeg`; `Mt5Trade` separately |
| Exit check | 60 s tick, 5m candle high/low + quote | 15 s monitor, **spot price only** (wicks missed) | broker-side SL/TP |
| Partial close | no | half only | no (one leg per TP instead) |
| Breakeven | no | button, no buffer | after TP1, no buffer |
| Trailing | no | no (AI tighten only, ≥1R) | no |
| TP | one, software | software on every venue (OANDA sends no `takeProfitOnFill`) | broker-side per leg |
| R / MFE / MAE | no initial stop stored → impossible | tracked, **hidden from DTO/UI** | R only, no money result |
| Sync back | n/a | reconciler every 30 s | events + heartbeat only; manual MT5 edits invisible; in-memory report queue, no replay after offline |
| Journal on close | no | yes | no |

Shared code: sessions reuse only `markPosition`, `liquidationPrice`, `applySlippage` from the paper engine. Gross P&L, exit triggers, SL/TP side validation, breakeven, R, loss-streak guards are each written 2–4 times (TS and MQL5).

---

## P13 · Clean House

Rule for every task: behaviour unchanged, `npm run test:db` + lint + typecheck + build green, one commit per task, shims kept until the last task of the phase.

### P13a · Repo hygiene + docs (no code behaviour change)
1. Delete the 13 merged local branches and their remote copies; remove the 3 stale worktrees. **Decision D2** for PR #4 and `fix/cryptopanic-v2`.
2. **Decision D1**: retire `v2`. CI on `main` + PRs only; delete `v2` locally and on origin; `origin/HEAD` → `main`.
3. `package.json` name → `alphaboard`; remove `@types/bcryptjs`, `pino-pretty`; delete `tests/setup/serverOnly.ts`.
4. Remove Railway: env reads in `lib/ops/overview.ts` and `app/api/health` → one `appVersion()` using `VERCEL_GIT_COMMIT_SHA`/`APP_VERSION`; SignalCopier default URL → the Vercel domain.
5. Docs: rewrite HANDOFF deploy section (Vercel + Fly + Neon pooled/unpooled, where the worker runs, how to watch a session), README § Deploying, delete or rewrite `FEATURES.md`; move `docs/superpowers/plans/*` (P0–P12) and the security-rotation note to `docs/archive/`; add `docs/ARCHITECTURE.md` (folder map after P13c, data flow, worker loops).
6. `.env.example`: add `APP_VERSION`, `LAB_DISABLED`, `LOG_LEVEL`, `DATABASE_URL_UNPOOLED`.
7. knip pass: delete the 69 unused exports / 36 types that nothing will need (keep constants that tests or P14 will use).

### P13b · Foundations (new shared modules, old paths re-export)
1. `lib/env.ts`: zod-validated server env, parsed once in `lib/http/boot.ts`; replace the 35 `process.env` reads.
2. `lib/format/{number,money,date}.ts`: `pct`, `money`, `signedPct`, `timeAgo`, `hhmm`, `pricePrecision`; delete the ≈20 local copies.
3. `lib/trading/math.ts`: `dirOf(side)`, `rMultiple(entry, stop, price, side)`, `grossPnl`, `pnlPct`, `validateExits(side, entry, sl, tp)`; adopt in eval, signals/state, lab/edge, sessions/excursion, paper/engine, risk/verdict.
4. `lib/market/symbols.ts`: one `bareSymbol()` / `matchSymbol()`; adopt in `lib/signals/{importDraft,levels,format}.ts`.
5. `lib/market/http.ts` `binanceGet()` with host failover; adopt in candles, quote, lab/data/binance.
6. Routes: `adminRoute()` / `adminIdRoute()` (auth + rate limit + audit helper) for the 24 admin routes; `deviceRoute()` for the 3 MT5 routes; `readJson` in the 3 signal-desk routes; `exchangeTradingEnabled()` everywhere.
7. Rate limiter: **Decision D4** (Neon table vs Upstash). Default: a small `RateLimitBucket` table, pruned by the worker.
8. Types: PostMortem / AnalysisResult derived from `z.output`; delete the hand copies.

### P13c · Folder moves (git mv + shim, then delete shims)
1. `lib/binance.ts` formatters → `lib/format/`; dead converters deleted.
2. `lib/assetCatalog.ts` → `lib/market/catalog.ts`; patterns → `lib/market/patterns/`; `lib/site.ts` → `lib/config/site.ts`; `lib/prisma.ts` → `lib/db/client.ts`.
3. `lib/exchanges` + `lib/exec` → `lib/venues/{connections,reconciler}.ts`; `lib/mt5/devices` → `lib/signalDesk/devices`; `lib/mt5/{deals,import}` → `lib/lab/data/mt5`.
4. **Decision D3**: rename `lib/signals` → `lib/signalDesk` (API paths unchanged). The AI-analysis side keeps `signals`.
5. `lib/alerts` + `lib/db/alerts.ts` → `lib/alerts/`; `lib/jobs/tick.ts` → `lib/worker/tick.ts`; `lib/agents` → `lib/sessions/desk/`.
6. `hooks/*` → `lib/client/hooks/`; `lib/types/*` → each feature's `types.ts`.
7. Components: `components/academy/`, `components/journal/`, `PatternMiniVisual` → `components/market/`; `NavBar` → `components/shell/` rendered once from `app/(app)/layout.tsx`.
8. ESLint `no-restricted-imports`: no `@/lib/db/client` from `app/**`/`components/**`; no server libs in client files. Move the 22 routes + 5 pages that import prisma onto feature services.

### P13d · Page splits (one PR each, jsdom component tests added)
journal → `components/journal/{JournalForm,ScreenshotImport,JournalCard,Timeline,StatTile}` + `useScreenshotParse`; academy → `components/academy/{UploadPanel,AcademyResult,KeyLevels}` + `lib/academy/canvas.ts`; LabWorkbench → one file per panel; SessionRoom → `components/sessions/room/*` using shared `useNow`; setup → `components/setup/AssetPicker`; alerts → `components/alerts/{AlertForm,AlertList}`.

### P13e · Infra
1. `Dockerfile.worker` (no Next build, no HTTP healthcheck); CI builds it only when worker code changes.
2. Only Vercel migrates; worker entrypoint `--no-migrate`; `npm start` no longer migrates.
3. Prisma `directUrl = env("DATABASE_URL_UNPOOLED")`; drop the shell injection.
4. Delete `app/api/cron/tick` or keep it admin-only as a manual trigger. **Decision D5** on the legacy v1 import.

---

## P14 · Positions

Goal: one position core, used by paper, sessions and (via the wire protocol) MT5; the same management features everywhere; everything visible in one place.

### P14a · Shared position core (`lib/trading/positions/`)
- `scanExit(bars, quote, pos)` (from paper engine) used by **both** the paper tick and the session monitor (fixes the missed-wick bug: monitor fetches 1m bars since the last poll).
- `breakeven(pos, bufferAtr)`, `trail(pos, atr, mult, bars)`, `tpLadder([{price, fraction}])`, `nextExtremes` (MFE/MAE) in one module with unit tests.
- Store `initialStop` on `PaperPosition` (1 migration); R/MFE/MAE on both DTOs; `SessionPositionDto` exposes `bestPrice/worstPrice/initialStop/r`.
- Venue interface gains `setTakeProfit` and `closePartial(fraction)`; paper venue validates side in `setStop`.

### P14b · Paper
Partial close (any fraction), breakeven button, trailing stop (ATR × mult or fixed), TP ladder (up to 3), journal entry on every close, history pagination + filters, `markOpen` errors surfaced as "unavailable" instead of swallowed.

### P14c · Sessions
- Native TP: OANDA `takeProfitOnFill` + PUT on change; ccxt TP order where `features.takeProfitPrice` is true; software fallback stays.
- Monitor: candle scan (P14a), missing price → warning in the room after 3 misses, not silent `continue`.
- Fix OANDA `syncOne` booking a full close on a partial broker reduce; surface the swallowed errors in `ccxt.ts:230/236`, `reconciler.ts:50/52` as `SystemEvent`s.
- UI: free SL/TP edit, custom close fraction, trailing toggle on `PositionCard`.

### P14d · MT5 SignalCopier 1.13 → 1.15 + server
- 1.13: breakeven with buffer (points or ATR), stop step-up after TP2 (→ TP1), real partial close at TP1 (optional, `InpPartialPct`), ATR trailing ported from `GoldHybridSMC.mq5:525-610`; new commands `MOVE_SL`, `MOVE_TP`, `CLOSE_PARTIAL` in `lib/signals/wire.ts`.
- 1.14: heartbeat carries an open-position snapshot (ticket, symbol, side, volume, open, SL, TP, floating P&L, swap) → new `Mt5OpenPosition` upsert; reports carry profit/swap/commission; `TradeSignalLeg` gets money fields.
- 1.15: report queue persisted to a terminal file; on start, reconcile `ab:` positions against `HistoryDeals` and replay missed TP/SL/CLOSED; BE report sends the real price.
- Server guards mirror the EA guards (daily lock, streak, cooldown, max open) so Admin → Signals shows "blocked because …" before the EA rejects.

### P14e · One Positions page
`/positions`: open positions across paper, sessions and MT5 in one table (venue badge, R, MFE/MAE, SL/TP, floating P&L in account currency), the same actions on each row (close, partial, breakeven, trail, move SL/TP), closed history with filters. NavBar entry; admin sees all users' MT5 devices.

---

## Order and estimate

| Step | Size | Ships |
|---|---|---|
| P13a hygiene + docs | ½ day | PR, no risk |
| P13b foundations | 1–1½ days | PR |
| **P14a + P14d (1.13)** | 2 days | PR + EA recompile; real-money relevance highest |
| P14c sessions | 1 day | PR |
| P13c moves | 1 day | PR (mechanical) |
| P14b paper + P14e page | 1½ days | PR |
| P13d page splits | 1–2 days | one PR per page |
| P14d 1.14/1.15 | 1½ days | PR + EA |
| P13e infra | ½ day | PR |

Each PR: tests + lint + typecheck + build green, production image test before deploy where infra changes, Notion cards moved, Persian log line added.

## Decisions (Farjad, 2026-10-31)

- **D1** `v2` retired: `main` + feature PRs only. ✅ (remote branch deletions are Farjad's: see P13a task 1)
- **D2** PR #4 `fix/quota-step` updated to `main` for him to merge; `fix/cryptopanic-v2` dropped (already in `main`). ✅
- **D3** `lib/signals` → `lib/signalDesk` in P13c (default taken; URLs unchanged).
- **D4** Rate limiter store: Neon table (default taken).
- **D5** Legacy v1 import **stays**; P13c only consolidates it into `lib/import/`.
- **D6** Order: P13a → P13b → P14a + P14d → P14c → P13c → P14b + P14e → P13d → P14d 1.14/1.15 → P13e.
