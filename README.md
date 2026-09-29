# AlphaBoard

**Know when to trade, and when to stay flat.** AlphaBoard is an invite-only trading-intelligence workspace: it reads live markets across six timeframes, drafts a plan with the AI model you choose, lets you rehearse it with paper money, then grades every call against what price actually did next.

Analysis and paper trading only — AlphaBoard never places real orders and is not financial advice.

Version **2.0.0** · Next.js 16 · TypeScript · PostgreSQL · see [CHANGELOG.md](CHANGELOG.md)

---

## What it does

| | |
| --- | --- |
| **Read** | 66 assets — crypto (Binance), gold, indices and forex (Yahoo Finance). Trend and momentum from 5-minute to weekly candles side by side, candlestick and chart patterns (incl. order blocks and FVGs), futures funding / open interest / long-short, news and fundamentals. Missing data shows as “Unavailable”, never a guess. |
| **Decide** | One click asks the chosen AI model (OpenAI, Anthropic Claude, OpenRouter or DeepSeek) for a plan built from data the server gathers itself: entry, stop, target, sizing and reasoning. Output is schema-validated; the plan can be “stay flat”. |
| **Practise** | A 10,000 USDT paper account: isolated margin, leverage up to 20×, 0.05% slippage and a 0.05% fee per side, stops and targets checked every minute on candle highs/lows — even with the tab closed. |
| **Measure** | Every BUY/SELL signal is replayed on later candles and scored in R: win rate, expectancy, profit factor, drawdown, confidence calibration, by model / asset / timeframe. Your record shows on the trade ticket. |

Also: trade journal with AI screenshot auto-fill and post-mortems, chart-reading academy, price alerts (in-app bell, optional Telegram), signal archive, per-user AI allowance, admin console (system health, users, invites & waitlist, AI usage and cost).

## Run it locally

Requirements: Node 22+, Docker (for PostgreSQL).

```bash
git clone https://github.com/farjadp/AlphaBoard.git && cd AlphaBoard
npm install
cp .env.example .env              # fill in AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD and at least one AI key
docker compose up -d db            # PostgreSQL on localhost:5434
npm run db:deploy                  # apply migrations
npm run db:seed                    # create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                        # http://localhost:3000
```

Sign in as the admin, accept the risk disclaimer, then invite traders from **Admin → Invites** (or convert requests from the landing-page waitlist).

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Session secret (`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | production | `true` behind Railway or another proxy |
| `APP_URL` | yes | Public base URL — invite links, sitemap, Open Graph |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first boot | Bootstraps the first admin (idempotent) |
| `OPENAI_API_KEY` | one AI key | Default provider (default model `gpt-5.4-mini`, images `gpt-4o`) |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY` | optional | More providers; only providers with a key can be chosen |
| `AI_DEFAULT_PROVIDER`, `AI_DEFAULT_MODEL` | optional | Initial default until an admin sets one in **Admin → AI** |
| `NEWS_API_KEY`, `CRYPTOPANIC_KEY` | optional | News panels |
| `TELEGRAM_BOT_TOKEN` | optional | Alert delivery to Telegram (users link a chat in Settings) |
| `CRON_SECRET` | optional | Lets an external scheduler call `POST /api/cron/tick` |
| `TICK_DISABLED` | optional | `1` turns the in-process 60-second scheduler off |

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Dev server / production build / `prisma migrate deploy && next start` |
| `npm test` · `npm run test:db` | Unit tests · unit + PostgreSQL tests (schema `test` on the local database) |
| `npm run typecheck` · `npm run lint` | `tsc --noEmit` · ESLint (both run in CI with the DB tests and the build) |
| `npm run db:migrate` · `npm run db:deploy` · `npm run db:seed` | Create a migration · apply migrations · bootstrap the admin |

### Docker

```bash
docker compose --profile full up --build     # app + postgres
```

The image runs as a non-root user, applies migrations at boot and exposes `GET /api/health` (database and scheduler status).

## How it is built

- **Auth & access:** NextAuth (credentials, JWT), invite-only registration, `requireUser()` / `requireAdmin()` in every route handler and server action, risk-disclaimer gate in `proxy.ts`.
- **Security:** nonce-based CSP (`proxy.ts`) plus HSTS, frame, referrer and permissions headers (`next.config.ts`); per-IP rate limits (auth, AI, API, public forms); size-capped JSON bodies; zod validation on every input and every AI answer.
- **Data:** PostgreSQL via Prisma migrations; every row scoped to its user; screenshots as owner-only attachments; `/import` moves data saved in the browser by v1.
- **Scheduler:** one 60-second tick in the server process settles paper stops/targets, snapshots equity, grades signals, fires alerts and processes Telegram link messages. Run a single instance, or disable it and call `/api/cron/tick`.
- **Observability:** pino JSON logs with a request id on every response; server errors stored for **Admin → System**.

Project docs: `docs/HANDOFF.md` (current state, conventions, deploy checklist), `docs/superpowers/specs/` (design spec), `docs/audits/` (accessibility and UI audit), `PRODUCT.md` (product brief).

## Deploying (Railway)

1. Use a fresh PostgreSQL database (migrations must own the schema; do not `db push`).
2. Set the environment variables above (`AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `APP_URL`, `ADMIN_*`, AI keys).
3. Keep **one** replica — the scheduler runs in-process.
4. After the first boot: sign in as the admin, accept the disclaimer, check **Admin → System** shows the scheduler running.

---

*AlphaBoard is an analysis and education tool. It does not provide financial advice. Trading, especially with leverage, carries a high risk of loss. The legal text in `/legal` is a draft and should be reviewed by a lawyer before public launch.*
