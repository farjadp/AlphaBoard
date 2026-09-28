## [Unreleased] — v2 in progress

### P2 · Persistence (2026-09-28)
- **Your data lives in your account:** journal, post-mortem lessons, AI signal archive, chart-academy studies, price alerts and watchlist moved from browser localStorage to PostgreSQL, scoped per user.
- **Screenshots** are stored as compressed attachments and served only to their owner.
- **Import browser data** (`/import`, also linked from a dashboard banner): previews what is found, compresses and uploads images, and imports idempotently (running it twice adds nothing; a later run can attach images that failed earlier).
- **AI strategy reports** are archived on the server at generation time, with the exact price the model saw; the prompt now reads the trader's own lessons from the database instead of accepting them from the client.
- **Account menu**: sign out (clears all cached data), import, admin link. Data refreshes when you return to the tab.
- **Tests:** 84 (including Postgres-backed isolation tests proving one user cannot read, change, or reference another user's data).

### P1 · Data integrity (2026-09-28)
- Server-side market-data layer with caching; real intraday candles for indices, commodities and FX; trend and stretch scored separately.
- Removed every fabricated value (mock prices, fixed long/short panel, fake news, mock AI output); real funding, open interest and long/short ratio.
- Validated AI output for all AI routes; images accepted only as size-capped inline data.
- Fixed WebSocket leak, alert bugs, journal upload hang, PnL on zero entry; ESLint rules re-enabled.

### P0 · Foundation (2026-09-27)
- **Security:** invite-only registration, `requireUser()`/`requireAdmin()` data-access layer, every API route authenticated and rate-limited, strict security headers, capped request bodies.
- **Ops:** PostgreSQL migrations (`prisma migrate`, no more `db push`), admin bootstrap seed, `/api/health`, pino JSON logging with request ids, error/404 pages.
- **Delivery:** Dockerfile (non-root, standalone), docker-compose, GitHub Actions CI (typecheck, lint, test, build), Vitest.
- **Removed:** unfinished `/portal` skeleton and root test scripts.

# Changelog

All notable changes to the AlphaBoard project will be documented in this file.

## [Unreleased] - 2026-05-09

### Added
- **Institutional-Grade AI Engine**: Upgraded signal generation prompt to strictly enforce `temperature: 0` determinism using `gpt-4o`, preventing conflicting signal generation (Signal Flipping).
- **Advanced Technical Levels**: The AI now extracts and outputs up to 3 Support and Resistance levels for every analysis.
- **Safe Entry Zones**: Added capability to identify 1 to 3 "Safe Entry" zones based on technical structures, aiding in execution patience.
- **HOLD Enforcement**: The AI is now explicitly trained to select `HOLD` during high-volatility, low-probability, or ranging markets, prioritizing capital preservation over forced trades.
- **Full Asset Support**: Connected the backend Indicators API directly to the comprehensive `ASSET_CATALOG`, unlocking AI Analysis for all 60+ assets (Crypto, TradFi, Indices, Commodities, and Forex) available in the Setup page.

### Fixed
- **Random/Unstable AI Output**: Addressed issue where the AI would provide conflicting bias within short timeframes by heavily modifying the prompt logic and enforcing deterministic outputs.
- **Yahoo Finance Integration (TradFi/Commodities)**: Fixed API crash for XAU/USD and other TradFi assets by migrating from the deprecated `historical` endpoint to the `chart` endpoint in `yahoo-finance2`.
- **Missing Crypto Pairs**: Resolved backend parsing errors by adding `SOL/USDT` and `XRP/USDT` to the core database loop.
- **Syntax Errors**: Fixed build errors in server actions caused by unescaped complex template literals during prompt processing.
