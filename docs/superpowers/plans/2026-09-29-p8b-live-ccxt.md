# P8b · Live execution via ccxt — Implementation Plan

Spec: `docs/superpowers/specs/2026-09-28-p8-agent-trading-sessions-design.md` (E4–E7, §4.1, §4.2 ExchangeConnection, §4.5, §7). Builds on P8a.

## Rulings

- **ccxt `4.5.84`, exact pin.** Loaded only on the server (`serverExternalPackages`), inside the worker/venue code.
- **Gating.** Any exchange session (testnet or real) needs `LIVE_TRADING_ENABLED=1` and the ADMIN role. A real-money session (connection not in sandbox) also needs the typed confirmation `LIVE`. `TRADING_HALT=1` refuses new entries everywhere; exits still run.
- **Keys.** AES-256-GCM with `EXCHANGE_KEY_SECRET` (32 bytes, base64). Stored as `v1:<iv>:<tag>:<ciphertext>`. Missing or invalid secret → exchange features off (fail closed). Only the last 4 characters of the key ever leave the server.
- **Symbols.** Sessions still pick catalog symbols (market data for the agents). A connection has a quote currency (default USDT). `BTC/USDT` maps to `BTC/<quote>` on spot and `BTC/<quote>:<quote>` on swap. A symbol the exchange does not list is rejected at session start.
- **Stops are software stops in P8b.** The 15 s monitor closes at market, and the room says so at start. Native exchange stops differ per venue and are a follow-up card (P8c). Cost if wrong: a worker outage leaves positions unprotected; the reconciler and the kill switch remain.
- **Orders are market orders.** A deterministic `clientOrderId` is written to the DB (PENDING) before the call. On timeout or network error the order is looked up by client id (up to 3 tries) before anything else; if it stays unknown → HALT with RECONCILE_MISMATCH. Never a blind retry.
- **Fees.** Taken from the fill (`order.fee` / `fees`). A fee paid in the base asset is converted at the fill price, and on spot longs it also reduces the held quantity, so the close sells what is actually held.
- **Reconciler (every 30 s, exchange sessions).** Spot: the free + used base balance must cover the open long quantity (tolerance: one qty step + 0.5%). Swap: exchange position contracts per symbol must match ours (same tolerance). Unknown open orders with our `ab-` prefix → cancel and HALT. Any mismatch → HALTED/RECONCILE_MISMATCH + notification. Manual trades in other symbols are ignored.

## Tasks

1. **Schema + secrets.** `ExchangeConnection` model (+ `TradingSession.connectionId`), `lib/secrets/crypto.ts` (encrypt/decrypt/last4, tamper detection). Tests: round trip, tamper, wrong key, missing secret.
2. **Connections service + API + Settings UI.** Create (validate the exchange id against `ccxt.exchanges`, encrypt), list (masked), test (loadMarkets + fetchBalance → status OK/ERROR + message), delete (refused while an active session uses it). Admin + `LIVE_TRADING_ENABLED` only. Routes `app/api/exchanges/**`; UI section in `/settings`.
3. **ccxt client + venue.** `lib/venues/ccxtClient.ts` (cached instance per connection/keyVersion; sandbox; rate limit; time sync; `recvWindow` 5000; `defaultType`). `lib/venues/ccxt.ts` implements `Venue` (kind `ccxt`): marketRules (limits, step, taker fee, live ticker), openPosition, closePosition (reduceOnly on swap), setStop (DB). Venue interface widened (`kind: "paper" | "ccxt"`, `live: boolean`, `symbolFor`). DB tests with a fake exchange: fill, replay, timeout → lookup found / not found, fee in base, below-min rejection, partial close.
4. **Mandate + start + gating.** `venue: "paper" | "exchange"`, `connectionId`, `confirmLive`. `startSession` checks gating, connection ownership + status OK, symbol listing, capital ≤ free quote balance (testnet included). `venueFor(session)` builds the ccxt venue. Room start message states venue, sandbox/live and the stop mode.
5. **Reconciler + halt paths.** `lib/exec/reconciler.ts`, called from the monitor for exchange sessions (30 s cadence per session via `lastReconciledAt`). `TRADING_HALT` in the venue. Kill cancels our open orders.
6. **Mandate form + room.** Venue picker (paper / verified connections), typed LIVE confirmation, live badge in the room and list.
7. **Build + docs + verification.** `serverExternalPackages: ["ccxt"]`, check `.next/standalone/node_modules/ccxt`. Opt-in integration test (`CCXT_TESTNET_KEY/SECRET`): Binance Spot Testnet open/close. Live check on the testnet with Farjad's testnet keys entered in Settings. HANDOFF, CHANGELOG, README, `.env.example`, Notion.
