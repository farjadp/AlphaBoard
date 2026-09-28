# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Self-directed traders of crypto, gold, stock indices and forex who make their own decisions and want evidence before risking money. Primary situation: at a desk, checking a market, deciding whether there is a trade today, and later reviewing whether their (and the AI's) calls were any good. Access is invite-only; the public landing speaks to prospective users who do not know AlphaBoard yet (confirmed 2026-09-28).

## Product Purpose
A trading-intelligence workspace: read live markets across timeframes, draft a plan with an AI model of the user's choice, rehearse it with paper money, and measure every call against what price did next. Success = users trade less on hunches, can see when an AI plan is not worth taking, and have a measured track record instead of a stated "confidence %".

## Positioning
The loop is closed and honest: every AI signal is replayed on later candles and graded in R (win rate, expectancy, profit factor, drawdown, calibration of stated confidence). Plans can say "stay flat". Missing data is shown as "Unavailable", never guessed. No live order execution — analysis and paper trading only.

## Operating Context
Market screen (watchlist tabs, 24h session band, chart + trade ticket, timeframe agreement 5M–1W, patterns, futures positioning, news), paper account (10,000 USDT default), performance page, trade journal with AI post-mortems, chart academy, price alerts (in-app bell, optional Telegram), archive of signals.

## Capabilities and Constraints
- Multi-user, invite-only; admins create invites; the landing collects access requests into a waitlist admins convert to invites.
- AI providers: OpenAI, Anthropic (Claude), OpenRouter, DeepSeek; default model gpt-5.4-mini; per-user daily token quota.
- Paper fills: live price ± 0.05% slippage, 0.05% fee per side; SL/TP checked every minute on candle high/low.
- Signal horizon per timeframe; conservative scoring (same-candle SL+TP counts as the stop).
- Data sources: Binance (crypto), Yahoo Finance (others) — public, no guarantees.
- Not financial advice; users must accept the risk disclaimer before using the app.
- UI language: English.

## Brand Commitments
Name "AlphaBoard". Light "briefing" visual world already in code (app/globals.css tokens; Manrope / JetBrains Mono / Bricolage Grotesque). Voice: plain, specific, candid about limits; no hype.

## Evidence on Hand
- Real product screenshot: public/landing/market.webp (2026-09-28, BTC/USDT 1H, live data; the AI plan says "Stay flat. No clean setup").
- No testimonials, customer logos, user counts, performance statistics or pricing exist. Never fabricate them.

## Product Principles
1. Evidence over confidence: show the measured record, not just the model's claim.
2. Never invent a number: unavailable is an answer.
3. Conservative by default: scoring and simulation never flatter the result.
4. The user decides: tools inform; AlphaBoard never trades for them.

## Accessibility & Inclusion
WCAG 2.1 AA contrast and keyboard access as the working standard (no stricter requirement confirmed).
