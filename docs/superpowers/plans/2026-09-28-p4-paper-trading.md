# P4 · Paper Trading — Implementation Plan

Spec: `docs/superpowers/specs/2026-09-27-alphaboard-v2-design.md` (D8, D9, §3.1, §3.3).

## Model decisions

- One `PaperAccount` per user, created lazily on first visit: 10,000 USDT (reset lets the user pick 100–10,000,000).
- **Isolated margin.** A ticket is margin (USDT) × leverage (1–20). Notional = margin × leverage, qty = notional / fill.
- **Fills** (D8): market at the live quote with 0.05% adverse slippage (buy higher, sell lower); 0.05% taker fee on each side's notional.
- **Cash**: opening debits margin + entry fee; closing credits margin + gross PnL − exit fee (never below 0 — loss is capped at the margin).
- **Realized PnL** is net: gross − entry fee − exit fee.
- **Exits checked on candle high/low** (5m candles) plus the live quote, per position from `lastCheckedAt`:
  - Stop level = the tighter of SL and the liquidation price (`entry·(1 − 1/lev)` long, `entry·(1 + 1/lev)` short).
  - SL and TP in the same candle → assume the stop (conservative).
  - Stop fills at the level, or at the open if the candle gapped through it; then slippage. TP fills at the level minus slippage.
  - The candle that contains the open time is skipped (its extremes may predate the entry); the live quote covers that gap.
- Marks come from `getQuote`; if a quote is unavailable the mark / unrealized / equity are `null` → UI shows "Unavailable".
- **Equity snapshots**: after every open/close/reset, and every 15 min per account with open positions from the tick.
- **Tick** (`lib/jobs/tick.ts`): every 60s via `instrumentation.ts` (guarded, no overlap, off in tests / `TICK_DISABLED=1`), and `POST /api/cron/tick` (`Authorization: Bearer $CRON_SECRET`, or an admin session). Health → `AppSetting["tick.last"]`.
- **Idempotent closes**: `updateMany where closedAt = null` inside a transaction, so a manual close and the tick cannot both settle a position.

## Files

- `prisma/schema.prisma` + migration: `PaperAccount`, `PaperPosition`, `PaperOrder`, `EquitySnapshot`, enums.
- `lib/paper/engine.ts` (pure): fills, fees, open/close math, liquidation, candle exit scan, marks/equity. Tests: `tests/unit/paperEngine.test.ts`.
- `lib/paper/account.ts` (server-only, DB): get-or-create, open, close, update SL/TP, reset, snapshot, overview DTO. Tests: `tests/db/paper.test.ts`.
- `lib/jobs/tick.ts`, `lib/jobs/scheduler.ts`, `instrumentation.ts`, `app/api/cron/tick/route.ts`.
- API: `app/api/paper/account` (GET overview, POST reset), `app/api/paper/orders` (POST open), `app/api/paper/positions/[id]` (PATCH SL/TP), `app/api/paper/positions/[id]/close` (POST).
- UI: `app/paper/page.tsx`, `components/paper/*`, `hooks/usePaper.ts`; NavBar link; "Trade on paper" in `/archive` → `/paper?signal=<id>`.
- Tick health: exposed as a `tick` field on `/api/health` (the full admin system dashboard is P7).
