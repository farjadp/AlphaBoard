# AlphaBoard v2 ("Pro") — Design Spec

Date: 2026-09-27
Status: DRAFT — awaiting approval
Author: Claude (with Farjad P.D)

## 1. Goal

Turn AlphaBoard from a single-browser, unauthenticated dashboard into a
multi-user, invite-only, production-grade trading-intelligence workspace on
the existing Next.js 16 / TypeScript / Tailwind v4 / Prisma / PostgreSQL stack,
closing all 31 findings of the 2026-09-27 code review and adding four
capabilities borrowed from QuantDinger: paper trading, signal evaluation
(backtest of archived AI signals), multi-provider AI, and observability +
containerized deployment.

Explicitly out of scope: live order execution against any exchange or broker.
AlphaBoard remains an analysis and paper-trading tool.

## 2. Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Keep Next.js 16 App Router; no rewrite on QuantDinger's Python/Vue stack | Preserves 9k lines of working code; matches Farjad's default stack |
| D2 | Invite-only multi-user. Roles: `ADMIN`, `USER`. First admin bootstrapped from `ADMIN_EMAIL` + `ADMIN_PASSWORD` env on first `prisma db seed` | Simplest safe multi-user model; no open registration, no email verification needed |
| D3 | NextAuth v5 (credentials + JWT) stays; every page except `/login`, `/register?token=…`, `/api/health` and the public landing page requires a session; **every** route handler and server action calls `requireUser()` (DAL) — proxy is only an optimistic check | Next.js security guidance: never rely on proxy/layout checks alone |
| D4 | All user data moves from localStorage to PostgreSQL via Prisma with real migrations (`prisma migrate deploy` at start, never `db push`) | Durability, multi-device, per-user ownership |
| D5 | Screenshots are stored as `bytea` in Postgres (`Attachment` model) after client-side downscale to ≤1600px JPEG q0.8, hard cap 1.5 MB, served by an authenticated route | No external object storage dependency at invite-only scale; can move to S3 later behind the same interface |
| D6 | A one-time **Import from this browser** page migrates existing localStorage data into the user's account | Farjad's own history is not lost |
| D7 | AI provider abstraction `lib/ai/` with providers: `openai`, `anthropic`, `openrouter`, `deepseek`. Every model output validated with zod; `finish_reason` checked. Default provider/model set by admin; user can override per request. Every call logged to `AiUsage` (tokens, est. cost, latency, status); per-user daily token quota enforced | Cost control, auditability, no vendor lock-in |
| D8 | Paper trading: one `PaperAccount` per user (default 10,000 USDT, configurable). Fill model = market at current price ± 0.05% adverse slippage, 0.05% taker fee per side on notional (QuantDinger's model). Positions carry SL/TP; server tick checks candle high/low, not last price | Realistic-enough simulation without broker connectivity |
| D9 | Scheduler: `instrumentation.ts` `register()` starts a guarded 60s tick (single Railway instance) AND `/api/cron/tick` (secret header) exists for external triggering | No extra service; still works if we later move to a cron |
| D10 | Signal evaluation: every archived `Signal` is evaluated against subsequent candles: `TP_HIT`, `SL_HIT`, `EXPIRED` (horizon = N bars by timeframe), or `OPEN`; R-multiple recorded. Aggregates: win rate, expectancy (R), profit factor, max drawdown (R), by symbol / timeframe / confidence bucket; calibration view (stated confidence vs realized win rate) | Replaces uncalibrated "confidence %" with measured performance |
| D11 | Alerts evaluated server-side in the tick; delivered to an in-app notification center; optional Telegram bot delivery when `TELEGRAM_BOT_TOKEN` is set | Alerts actually fire without a tab open |
| D12 | Observability: pino JSON logs with request id, `/api/health` (DB ping + version), `error.tsx`/`global-error.tsx`/`not-found.tsx`, admin dashboard (users, AI usage/cost, tick health, recent errors) | Minimal, self-hosted, no Grafana dependency |
| D13 | Deployment: `Dockerfile` (standalone output, non-root), `docker-compose.yml` (app + postgres) for local, GitHub Actions CI (typecheck, lint, test, build). Railway stays the production target (project `AlphaBoard-Trading`, Postgres service present) | Reproducible environments |
| D14 | Security: strict headers in `next.config.ts` (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy), request body size limits, per-IP in-memory rate limit on auth + AI routes plus DB-backed AI quota, zod validation on every input, no secrets in query strings | Production checklist |
| D15 | UI: remove all inline `style={{}}` in favour of Tailwind v4 `@theme` tokens; replace Inter with a distinct pairing (body: **Manrope**, mono: **JetBrains Mono**); remove purple-blue gradients; add loading/empty/error states, keyboard focus, aria labels; run `/impeccable audit` + `polish` before release | Farjad's own standards + impeccable rules |
| D16 | Pattern descriptions become English (UI is English); hardcoded Long/Short panel and mock price fallbacks removed; every "unavailable" datum shows as unavailable, never as a number | Data integrity |
| D17 | Tests: Vitest for pure logic (PnL, ATR, consensus, pattern detectors, paper fill engine, evaluator) and route handler tests with a test DB; ESLint rules re-enabled (`set-state-in-effect`, `exhaustive-deps`, `no-explicit-any`) | Findings 25, 28 |
| D18 | Legal: first-login acceptance of a risk disclaimer + terms; persistent footer disclaimer | Finding 31 |

## 3. Architecture

```
app/
  (public)/            landing, login, register (invite), legal
  (app)/               authenticated shell: dashboard, market/[symbol], journal,
                       archive, academy, alerts, paper, performance, settings
  admin/               users & invites, AI settings, usage, system health
  api/
    auth/[...nextauth]  health  cron/tick  attachments/[id]
    market/{quotes,indicators,news,futures,global,fundamentals}
    ai/{analyze,parse-screenshot,post-mortem,chart-academy}
    journal  signals  lessons  chart-lessons  watchlist  alerts
    paper/{account,orders,positions}  performance  import
lib/
  auth/   dal.ts (requireUser/requireAdmin), invites.ts, password.ts
  ai/     index.ts (chatJSON), providers/{openai,anthropic,openrouter,deepseek}.ts,
          schemas.ts (zod), usage.ts (quota + logging), prompts/
  market/ binance.ts, yahoo.ts, indicators.ts, patterns/, futures.ts
  paper/  engine.ts (fills, fees, slippage, SL/TP), account.ts
  eval/   evaluator.ts (signal outcomes), metrics.ts
  db/     prisma.ts, repositories/*.ts
  jobs/   tick.ts (alerts + paper + eval), scheduler.ts
  http/   rateLimit.ts, errors.ts, logger.ts, requestId.ts
prisma/   schema.prisma, migrations/, seed.ts
tests/    unit/, routes/
```

### 3.1 Data model (Prisma)

User(id, email, passwordHash, name, role, disclaimerAcceptedAt, aiProvider?, aiModel?, dailyTokenQuota, createdAt)
Invite(id, token(unique), email?, createdById, expiresAt, usedAt?, usedById?)
WatchlistItem(id, userId, symbol, position) @@unique(userId, symbol)
JournalEntry(id, userId, symbol, position, entryPrice, exitPrice?, pnlPercent?, grossPnlPercent?, feeRatePercent?, pnlSource, emotion, notes, leverage?, margin?, marginMode?, status, screenshotId?, postMortem Json?, openedAt, closedAt?, createdAt)
TradeLesson(id, userId, journalEntryId?, symbol, position, outcome, pnlPercent?, rootCause, mistakes String[], strengths String[], lesson, tags String[], emotion?, createdAt)
Signal(id, userId, symbol, timeframe, signal, confidence, priceAtSignal, entry, stopLoss, takeProfit, tradeStyle?, riskManagement Json?, reasoning, indicatorsBreakdown Json?, supportResistance Json?, safeEntries Json?, provider, model, createdAt)
SignalEvaluation(id, signalId(unique), status[OPEN,TP_HIT,SL_HIT,EXPIRED], rMultiple?, resolvedAt?, barsElapsed, lastCheckedAt)
ChartLesson(id, userId, symbol?, overallSignal, confluenceScore, summary, lesson, patterns String[], tags String[], mistakes String[], strengths String[], charts Json, createdAt)  // chart images → Attachment ids inside `charts`
Attachment(id, userId, mime, bytes Bytes, size, width?, height?, createdAt)
PriceAlert(id, userId, symbol, targetPrice, condition, status[ACTIVE,TRIGGERED,DISMISSED], triggeredAt?, createdAt)
Notification(id, userId, type, title, body, data Json?, readAt?, createdAt)
PaperAccount(id, userId(unique), startingBalance, cashBalance, currency, createdAt, resetAt?)
PaperPosition(id, accountId, symbol, side, qty, entryPrice, leverage, stopLoss?, takeProfit?, signalId?, openedAt, closedAt?, closePrice?, realizedPnl?, fees, closeReason?)
PaperOrder(id, accountId, positionId?, symbol, side, type[MARKET], qty, requestedPrice, fillPrice, slippage, fee, status, createdAt)
EquitySnapshot(id, accountId, equity, at)
AiUsage(id, userId, provider, model, feature, promptTokens, completionTokens, estCostUsd, latencyMs, status, error?, createdAt)
AppSetting(key(unique), value Json)  // default provider/model, quotas, feature flags
AuditLog(id, userId?, action, target?, meta Json?, ip?, createdAt)

### 3.2 Request flow (AI)

client → `/api/ai/analyze` → `requireUser()` → rate limit (IP) → quota check (`AiUsage` today) → build prompt (server-side from indicators fetched **server-side**, not trusted from client) → `chatJSON(provider, model, schema)` → zod validate → persist `Signal` → log `AiUsage` → response.

Note: the current design trusts `indicators` posted by the client. v2 recomputes indicators server-side from `symbol` + `timeframe` so a user cannot feed fabricated indicator data into the prompt.

### 3.3 Tick job (every 60s)

1. Collect symbols from open PaperPositions, ACTIVE PriceAlerts, OPEN SignalEvaluations.
2. Fetch latest 1m/5m candles per symbol (Binance vision for crypto, Yahoo for others).
3. Alerts: trigger on high/low crossing; create Notification (+Telegram).
4. Paper: SL/TP hit on high/low → close at level ± slippage, fee; snapshot equity.
5. Eval: for signals in OPEN, walk new bars; resolve TP/SL/EXPIRED; compute R.
6. Record tick health in AppSetting `tick.last` for the admin dashboard.

### 3.4 Data-integrity fixes folded in

- Non-crypto multi-timeframe uses real Yahoo intraday intervals (5m/15m/60m within provider limits); timeframes that cannot be served are marked `available: false` and excluded from consensus.
- Futures (funding, OI) fetched server-side; `null` → UI "Unavailable".
- Trend score: separate trend component (MACD, SMA, EMA, chart pattern) from mean-reversion component (RSI, BB) and report both instead of summing them.
- Prompt: single Data block, real newlines, English pattern descriptions, no client-supplied lesson text without length caps.

## 4. Phases (each independently shippable, each ends in a commit + green CI)

| Phase | Deliverable |
|-------|-------------|
| P0 Foundation | Branch `v2`, Postgres via docker-compose for dev, Prisma migrations baseline, `requireUser/requireAdmin` DAL, invites + admin seed, proxy protecting all app routes, security headers, rate limit, pino logger + request id, `/api/health`, error/not-found pages, Dockerfile, CI workflow, `migrate deploy` start script |
| P1 Integrity | All review findings fixed: mock removal, Long/Short panel removed, real intraday MTF, futures route, prompt bugs, zod on model output, WS leak, alerts logic, screenshot compression + cap, NewsAPI header, Yahoo/Binance request coalescing + caching, ESLint rules on, Vitest suite for pure logic |
| P2 Persistence | Prisma models above; repositories; server actions/routes; 7 hooks rewritten to server-backed data with optimistic UI; Attachment storage; Import-from-browser page; portal skeleton removed (single app shell) |
| P3 AI providers | `lib/ai` abstraction, four providers, zod schemas, usage logging, per-user quota, settings UI (user) + AI defaults (admin) |
| P4 Paper trading | Engine + tests, account/positions/orders UI, "Trade on paper" from a signal, equity curve, reset account |
| P5 Signal evaluation | Evaluator + metrics + tests, Performance page (win rate, expectancy, profit factor, drawdown, calibration chart, filters) |
| P6 Alerts & notifications | Server-side alert evaluation in tick, notification center, optional Telegram |
| P7 UI/UX & release | Tailwind tokens, fonts, remove inline styles, landing page + SEO metadata/OG/robots/sitemap, disclaimer acceptance, a11y pass, `/impeccable audit` + `polish`, README/CHANGELOG/deploy docs, tag `v2.0.0` |

## 5. Non-goals

- Live trading, exchange API keys, broker connections
- Billing / payments
- Mobile app
- Strategy scripting / parameter optimization (QuantDinger's evolution engine)

## 6. Risks

- Yahoo Finance is unofficial and rate-limited: mitigated by server-side caching (per symbol+interval, 60–300s) and request coalescing.
- Single-instance scheduler: acceptable on Railway; documented; `/api/cron/tick` allows moving to a cron later.
- Repo lives in a Google Drive–synced folder: `node_modules` and `.git` churn can be slow or conflict; recommend moving the checkout outside Drive (not blocking).
