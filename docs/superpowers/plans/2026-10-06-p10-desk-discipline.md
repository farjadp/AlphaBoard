# P10 — Desk discipline (lessons from the first live OANDA week)

**Why:** the first three live OANDA sessions (2026-09-29, 09-30 and 10-01, C$80 each) went 0 for 5.
- The trades themselves lost C$2.31. About $5.45 of AI cost came on top of that.
- A fourth session (Fri 10-02) could not close a USD/CAD long, because the FX market had shut at 21:00 UTC. The position stayed open over the weekend with only its broker stop.
- Root causes, from the prod session data:
  - the desk entered on cycle 1 by picking the "best of the allowed symbols" at conviction 0.60–0.68, overriding the Bear's "stay flat";
  - stops sat inside normal noise (EUR/USD 12 pips; USD/JPY stops hit in 27 and 44 minutes);
  - stops were moved to breakeven or tightened before the trade had moved;
  - on 10-01 the desk was long USD and short USD at the same time;
  - the system has no notion of market hours;
  - the report mixes currencies: expectancy R is computed in quote currency × account P&L, and `netAfterLlm` subtracts US$ from C$.

The rule for every guard: **deterministic code decides; prompts only explain.**

## P10a — deterministic guards (risk engine + clock)

1. **Market hours** — `lib/market/hours.ts` (pure).
   - FX and metals close Friday 17:00 New York time and reopen Sunday 17:00 NY, with DST handled via `Intl`. Metals also have a daily 17:00–18:00 NY break.
   - **No new entries** within 60 min of the weekly close.
   - **Flatten** FX/metal positions 20 min before the close when `onEnd = CLOSE_ALL`. Under KEEP_WITH_STOPS, post an alert instead.
   - When every symbol is FX/metal and the close is ≤ 20 min away, **end the session**.
   - **Refuse to start** an FX/metal session while the market is closed or less than 60 min before the close.
   - Adds a new close reason, `MARKET_CLOSE` (migration).
2. **Volatility floor on stops**
   - An entry's stop must be ≥ `MIN_STOP_ATR` (1.5) × ATR(1H) from the price.
   - An entry with ATR unavailable is rejected.
   - The floor is shown to the strategist in the context.
3. **Stop discipline** — TIGHTEN_STOP is allowed only after the trade has moved ≥ 1R in its favour (R = entry → initial stop). The new stop must also stay ≥ 1 × ATR(1H) from the price.
4. **Currency exposure** — for FX/metal pairs, reject an entry that takes the opposite side of a currency already held. Example: short USD/JPY while short GBP/USD.
5. **Report fixes**
   - Expectancy R uses `quoteToAccount`.
   - The journal's `pnlPercent` uses margin in the account currency.
   - `netAfterLlm` is null when the account currency is not USD; the UI shows "—" with a note.

## P10b — decision discipline + AI cost

1. **Entry gate** in the risk engine:
   - conviction ≥ `MIN_ENTRY_CONVICTION` (0.7);
   - the 4H trend must not oppose the side.
2. **Prompts**:
   - "no trade" is the default;
   - "best of the allowed symbols" is not a reason;
   - the strategist must answer the Bear's case;
   - close early only when the invalidation has happened;
   - never move a stop to breakeven before 1R.
3. **No-setup cycles are cheap** — when nothing is open and no analyst note is directional with confidence ≥ 0.6, skip the debate and the strategist and post "no setup".

## P10c — learning loop

1. Track **MFE / MAE** per position in the monitor (new columns `maxFavorable` and `maxAdverse`, both prices). Also store the ATR at entry in the exit plan.
2. The journal gets real numbers: stop distance in ATR, time to exit, MFE/MAE in R and the close reason. The prompt asks for one **testable rule**, not advice.

Each phase ends with unit + DB tests, lint, typecheck and build green, a paper-session check in the running app, a commit, and Notion updated.
