# AlphaBoard 📈

**AlphaBoard** is an advanced, AI-driven Financial Intelligence Dashboard and Trading Workspace. It bridges the gap between raw market data and actionable trading strategies by leveraging real-time data feeds, comprehensive technical analysis, and multi-modal AI reasoning.

![AlphaBoard Overview](https://img.shields.io/badge/Status-Active-brightgreen.svg) ![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![OpenAI](https://img.shields.io/badge/AI-GPT--4o-blue?logo=openai)

---

## 🚀 Key Features

### 1. Multi-Asset Dashboard
- **Universal Tracking:** Monitor 60+ Assets across Cryptocurrency (via Binance) and Traditional Finance, Indices, Commodities, and Forex (via Yahoo Finance) in a single pane of glass.
- **Real-Time Data:** Live price tickers, 24h volume, and market capitalization.
- **Futures & Sentiment:** Open Interest, Funding Rates, and real-time news headlines dynamically fetched to provide fundamental context.

### 2. Institutional-Grade AI Signal Engine (GPT-4o)
- **Deterministic Logic:** Operates with `temperature: 0` to provide highly consistent, logical trading analysis without signal flipping.
- **Advanced Technical Mapping:** Extracts 3 distinct Support and Resistance levels and determines 1-3 highly probable "Safe Entry" zones for every analysis.
- **Capital Preservation:** Explicitly designed to output `HOLD` signals in volatile or low-probability environments to discourage forced entries.
- **Actionable Execution Plans:** When conditions align, the AI generates precise `BUY` or `SELL` signals complete with exact Entry, Take Profit, and Stop Loss levels based on current volatility and structure.

### 3. Strategy Archive & Post-Mortem Learning
- **Historical Backtesting:** Every generated strategy is permanently archived.
- **Contextual Awareness:** Past trades are analyzed to derive lessons, which are then fed back into the core AI Engine for context-aware future decision-making.

### 4. Advanced Trading Journal & Vision AI
- **Professional Metrics:** Log your trades with exchange-level precision, including Margin Mode (Cross/Isolated), Leverage, and Margin Amount.
- **Open Trades:** Log positions without an exit price to track "Open" trades, and update them later to instantly calculate PnL%.
- **AI Screenshot Auto-Fill:** Drag and drop a screenshot of your Binance or Bybit position. The integrated **GPT-4o Vision API** instantly reads the image and auto-fills your journal entry (Asset, Entry Price, Leverage, Margin).

---

## 🛠️ Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS (Custom Glassmorphism UI)
- **Data Providers:**
  - Binance API (Real-time Crypto Klines & Futures Data)
  - Yahoo Finance (`yahoo-finance2`) (TradFi Quotes & History)
  - NewsAPI (Real-time Fundamental Sentiment)
- **Technical Analysis:** `technicalindicators` library (RSI, MACD, BB, SMA, EMA)
- **Artificial Intelligence:** OpenAI API (`gpt-4o` for logic, `gpt-4o` Vision for image parsing)

---

## ⚙️ Setup & Installation

AlphaBoard v2 is **invite-only** and multi-user. It needs PostgreSQL.

```bash
git clone https://github.com/farjadp/AlphaBoard.git && cd AlphaBoard
npm install
cp .env.example .env            # fill in the values below
docker compose up -d db          # local Postgres on :5434
npm run db:migrate               # applies prisma/migrations
npm run db:seed                  # creates the first ADMIN from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                      # http://localhost:3000
```

Log in as the admin, open **/admin/invites**, create an invite link and send it to each trader.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | NextAuth JWT secret (`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | yes (prod) | Set to `true` behind Railway / a reverse proxy |
| `APP_URL` | yes | Public base URL, used in invite links |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first boot | Bootstraps the first admin (idempotent) |
| `OPENAI_API_KEY` | one AI key | Signal engine + Vision parsing |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY` | optional | Additional AI providers (P3) |
| `NEWS_API_KEY`, `CRYPTOPANIC_KEY` | optional | News feeds |
| `CRON_SECRET` | optional | Protects `/api/cron/tick` for external schedulers (P4) |
| `TELEGRAM_BOT_TOKEN` | optional | Alert delivery (P6) |

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Dev server / production build / `prisma migrate deploy && next start` |
| `npm test` · `npm run typecheck` · `npm run lint` | Vitest · `tsc --noEmit` · ESLint (all three run in CI) |
| `npm run db:migrate` · `npm run db:deploy` · `npm run db:seed` | Create/apply migrations · apply in prod · bootstrap admin |

### Docker

```bash
docker compose --profile full up --build     # app + postgres
```

The image runs as a non-root user, applies migrations at boot, and exposes `GET /api/health`.

### Your data

Everything a trader creates (journal, lessons, signal archive, chart studies, alerts, watchlist) is stored in PostgreSQL and scoped to their account; screenshots are stored as owner-only attachments. Data saved in the browser by earlier versions can be moved into the account at **/import**.

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests |
| `npm run test:db` | Unit + Postgres-backed tests (uses schema `test` on the local dev database) |

### Security model (v2)

- Every page except `/`, `/login`, `/register`, `/legal` requires a session; every Route Handler and Server Action calls `requireUser()` / `requireAdmin()` from `lib/auth/dal.ts`.
- Registration requires a single-use, expiring invite token created by an admin.
- Auth and AI endpoints are rate-limited per IP; JSON bodies are size-capped.
- Strict security headers (CSP, HSTS, X-Frame-Options, …) are set in `next.config.ts`.
- Structured JSON logs (pino) with a request id on every API response.

---

## 🧠 Moving Average Intelligence
The AI Engine is hardcoded to evaluate the market using the following institutional Cheat Sheet:
- \`5 EMA\` : Momentum
- \`10 EMA\`: Short-term trend
- \`20 EMA\`: Mean reversion
- \`50 SMA\`: Strong uptrend support
- \`100 SMA\`: Dip buy alert
- \`200 SMA\`: Trend shift
- \`250 SMA\`: Fair value

---

*Disclaimer: AlphaBoard is an intelligence tool designed to assist in market analysis. It does not provide financial advice. Trading cryptocurrencies and traditional assets carries significant risk.*
