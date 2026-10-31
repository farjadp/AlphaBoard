# P8c · Native exchange stops, bundled worker, MEXC check — Plan

Builds on P8b (`docs/superpowers/plans/2026-09-29-p8b-live-ccxt.md`). Spec §4.5 "Protective stops".

## Rulings

- **Native stop = a ccxt `stopLossPrice` market order** (verified on the Binance Spot Testnet: it rests as `STOP_LOSS` and can be cancelled). It is used when `exchange.features[spot|swap.linear].createOrder.stopLossPrice` is true (Binance, Bybit, OKX, Coinbase; not MEXC, not Kraken swap). Otherwise software stops, as in P8b. The room states the mode per session.
- **No schema change.** A resting stop is a `SessionOrder` row with purpose STOP, status OPEN and its `venueOrderId`. Client id: `ab-<session10>-sl-<position6>-<n>`.
- **Lifecycle:**
  - After an entry fills, place the stop for the quantity actually held.
  - To move a stop (tighten, breakeven): cancel it, then place a new one.
  - Before any market close, cancel the stop. If the cancel shows the stop already filled, book that fill (reason STOP_LOSS) instead of sending a second order.
  - After a partial close, re-place the stop for what remains.
  - `KEEP_WITH_STOPS` at the end leaves the stops on the exchange.
- **Stop fills are detected** every 15 s: `syncStops` fetches each open stop order and books a filled one exactly like a close.
- **Software fallback stays.** For positions with a native stop, the software stop fires only 0.3% beyond the stop level, giving the exchange order time to work. It then cancels the native stop and closes at market.
- **Take-profit stays software** (OCO support differs too much between exchanges).
- **Reconciler:** our open stop orders known to the ledger are expected; any other open order of ours still halts the session.
- **Worker bundle:** esbuild bundles `scripts/worker.ts` into `dist/worker.mjs`. Prisma and ccxt stay external; the standalone image already ships them. The Docker image carries the bundle, so a second Railway service can run `node worker.mjs` with `WORKER_MODE=separate` on the web service.
- **MEXC:** a research agent checks whether futures API orders work for regular accounts in 2026. The verdict goes into the HANDOFF and the connection form hint; no special casing unless needed.

## Tasks

1. Venue: `stopMode`, `setStop` (cancel + re-place), `syncStops`, cancel-before-close, re-place after partial, place after entry. Shared `bookExit` for market closes and stop fills. Fake-exchange tests: native stop placed; tighten replaces it; close cancels it; a filled stop is booked once; a close racing a filled stop books the stop and sends nothing; unsupported exchange → software.
2. Monitor + exits + reconciler: `syncStops` for exchange sessions each pass; stop slack for native-protected positions; room/Telegram messages for exchange stop fills; the reconciler accepts known open stops. Tests.
3. Worker bundle + Dockerfile + `npm run build:worker`; run the bundle locally against the dev DB; build the Docker image locally.
4. Live check on the Binance testnet: native stop visible on the exchange, tighten replaces it, a triggered stop is booked, kill cancels the stop and closes. Docs, Notion.
