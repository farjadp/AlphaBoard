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
