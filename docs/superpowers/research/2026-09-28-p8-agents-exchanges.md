# P8 research — AI trading agents + exchange execution

_2026-09-28 · input for the P8 spec. Scope: owner-only, spot-only, ~US$10 live test; open-source so others self-host with their own keys._

## TL;DR

- No public evidence that LLM trading agents beat buy-and-hold after fees; published gains shrink once look-ahead bias is controlled. P8 is judged as a **safe, auditable pipeline** (LLM proposes, deterministic code decides and executes), not as an alpha engine.
- **Zero-money target:** Binance Spot Testnet (`binance` + `setSandboxMode(true)`, GitHub login, reachable from Canada).
- **$10 live target:** Kraken (`kraken`), BTC/CAD or ETH/CAD, post-only limit orders. Runner-up: NDAX (0.20% flat, weaker ccxt module, no sandbox).

## Exchanges (Ontario resident)

OSC registered list (updated 2026-09-25): https://www.osc.ca/en/industry/registration-and-compliance/registered-crypto-asset-trading-platforms
Not available in Ontario: Binance, Bybit, OKX, KuCoin, Hyperliquid (terms list Ontario as restricted). Canadian platforms cannot offer USDT — quote in CAD or USDC.
Registered platforms **with** a public trading API: Kraken, Coinbase, NDAX, Crypto.com Exchange (Ontario access to the Exchange product unverified). No API: Bitbuy, Newton, Shakepay, Netcoins; Wealthsimple forbids API trading.

| | Kraken | NDAX | Coinbase Advanced | Binance Spot Testnet |
|---|---|---|---|---|
| Ontario | Restricted Dealer | Investment Dealer | Restricted Dealer | virtual funds only |
| Trade-only key / IP allowlist | yes / yes | scopes yes / IP unverified | yes / yes | n/a |
| Sandbox | none for retail; `validate=true` dry-run on AddOrder | ccxt staging URL dead | mocked static responses | real matching engine, virtual balances, monthly reset |
| Fees (lowest tier, maker/taker) | 0.40% / 0.80% | 0.20% flat | Canada rate unverified after 2026-09-16 change | free |
| BTC min | 0.00005 BTC (~C$5.90) | 0.00001 BTC (BTCCAD) | US$1 | 0.00001 BTC, 5 USDT notional |
| Min cost | 1 CAD / 0.5 USD | not found | US$1 | 5 USDT |
| CAD funding | Interac, min C$10 | Interac, no min | Interac, C$2+ | — |
| ccxt | `kraken` (no sandbox) | `ndax` (needs `uid`) | `coinbase` (ECDSA keys only, not Ed25519) | `binance`, certified, sandbox |

Gotchas: Kraken taker round-trip ≈1.6% on $10 → use post-only limits (0.40% maker); Kraken nonce must increase → one key per process; Ontario Investor Questionnaire required. Binance testnet: only `/api` endpoints, unrealistic liquidity; do **not** use `enableDemoTrading` (needs a real Binance account).

## Agent design — prior art

| Project | Borrow | Skip |
|---|---|---|
| TradingAgents (Apache-2.0, arXiv 2412.20138) | structured analyst reports; one bull/bear pass; reflection from realized outcome; quick/deep model split | LLM risk-debate team, multi-round debates, 10+ calls per decision; its 3-month backtest has look-ahead bias |
| Nof1 Alpha Arena (setup) | every action carries confidence + **exit plan** (TP, SL, `invalidation_condition`) that is re-injected on later calls | 2–3 min cadence (overtrading), leverage |
| virattt/ai-hedge-fund (MIT) | `risk/limits.py`: pure deterministic clamping with an audit trail; LLM influence ends at the signal | equities focus |
| FinRobot (Apache-2.0) | rule: numbers come from code, LLM only narrates | — |
| QuantDinger | separate execution worker; exits never gated by AI; encrypted keys; scoped live permission | — |
| LiveTradeBench | — | **PolyForm Noncommercial: do not copy code** |

Live evidence: Alpha Arena S1 (crypto perps, $10k each) — Qwen3 Max +22%, most others lost, Gemini ~238 trades / ~13% of capital in fees. StockBench and LiveTradeBench: most agents fail to beat buy-and-hold; LMArena rank does not predict trading. Agent Market Arena: framework matters more than the model.
Failure modes: overtrading/fee drag, volatility-blind sizing, weak stop discipline, random portfolio flips, arithmetic/schema errors, hallucinated prices, prompt sensitivity, brittleness in downturns, look-ahead bias in backtests.

## Safe execution patterns

- **Risk gate in code:** size = f(equity, risk %, stop distance); clamps (max position %, open positions, allowlist, trades/day, cooldown, fee+slippage hurdle); circuit breakers (max daily loss, max drawdown, stop-loss guard — Freqtrade "protections"); every clamp/reject logged with a reason; exits never blocked.
- **Kill switch:** DB flag checked before every order + env `LIVE_TRADING_ENABLED`; cancels open orders, optional flatten; UI + Telegram.
- **Idempotency:** write the intent row (PENDING) with a deterministic `clientOrderId` before `createOrder`. On timeout, **look up by client id before any retry** — Binance accepts a reused client id once the previous order is filled, so a blind retry can double-fill.
- **Reconciler** every 30–60 s and on boot: `fetchOpenOrders`, `fetchOrder`, `fetchMyTrades`, `fetchBalance`; exchange is source of truth; any mismatch → kill switch + alert.
- Partial fills (`filled/remaining/average/status`), clock sync (`adjustForTimeDifference`, small `recvWindow`), ccxt built-in rate limiter, one exchange instance per process.
- **Secrets:** trade-only keys, no withdraw, IP allowlist; AES-256-GCM at rest with master key from env; decrypt only in the executor; fail closed when `ENCRYPTION_KEY` is unset.
- **Cadence/cost:** 1–4 h loop + alert-triggered runs; skip the LLM when nothing changed; cheap analyst model, stronger strategist; show LLM cost next to P&L (on $10 it can exceed P&L).

## ccxt in this app

- `ccxt@4.5.84` (2026-09-24), MIT, ESM/CJS with types, ~59 MB. Pin the exact version.
- `setSandboxMode(true)` right after construction. `loadMarkets()` once; respect `limits.amount.min`, `limits.cost.min`; round with `amountToPrecision`/`priceToPrecision`.
- Retry only reads on `NetworkError`/`RequestTimeout`; `InsufficientFunds`/`InvalidOrder` are terminal.
- Next 16: server-only import, `serverExternalPackages: ['ccxt']`, verify ccxt lands in `.next/standalone/node_modules` (Next issue #88844 fix not confirmed for 16.2.4). Executor + reconciler belong in the tick/worker, not in route handlers.

## Proposed P8 shape (to be specced)

1. Analysts (technical from `lib/market`, news/sentiment) → strategist (structured, zod) → deterministic risk engine → executor (`paper` | `testnet` | `live`, one interface).
2. Strategist schema: `{action, symbol, conviction, thesis, exitPlan: {takeProfit, stopLoss, invalidation}, horizon}`; exit plan persisted and re-injected.
3. Paper first (existing engine), with a buy-and-hold BTC baseline and P5 metrics; optional multi-model arena on paper.
4. Live: owner only, `LIVE_TRADING_ENABLED`, hard cap $10 total / $5 per order in code, typed confirmation to arm, encrypted keys, reconciler, kill switch.
5. Reflection-lite: one lesson per closed trade, top-k injected.
6. Skip: futures/leverage, multi-round debates, LLM risk team, minute-level loops, historical LLM backtests, multi-exchange in P8.

## Not verified

Coinbase Canada fees after 2026-09-16; Crypto.com Exchange access for Ontario; NDAX IP allowlist, min cost and testnet; Kraken exact rate limits; Nof1 primary tech post (HTTP 429); TradingAgents v0.5.1 default model names; FINSABER figures; Next 16.2.4 standalone-externals fix.
