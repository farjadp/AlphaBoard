# P5 · Signal Evaluation — Implementation Notes

Spec: D10 in `docs/superpowers/specs/2026-09-27-alphaboard-v2-design.md`.

## Rules (lib/eval/evaluator.ts — pure, stateless, conservative)

- BUY/SELL only; HOLD is counted, never scored. Candles of the signal's **own timeframe**; bars that started before the signal are skipped.
- Entry within 0.1% of the price the model saw → filled at once; otherwise filled when price trades through the entry (running high/low from the signal price, so gaps count). Never filled within the horizon → `NO_FILL` (excluded from win rate).
- Fill bar: only the stop counts. Same bar SL+TP → stop. Gap through the stop → exit at the open (worse than −1R).
- Horizon: 15M 96 · 1H 72 · 4H 42 · 1D 30 · 1W 12 · 1M 6 bars; expires on the last *completed* horizon bar at its close → `EXPIRED` with a close-based R.
- R = (exit − entry) × dir / |entry − stop|. No fees (this measures the call, not an execution).
- `INVALID`: unknown timeframe/symbol, levels on the wrong side, or candles no longer reaching back to the signal.
- Outcomes are final once resolved; `OPEN` ones are re-run every tick (candles come from the shared market cache).

## Metrics (lib/eval/metrics.ts)

Trades = TP_HIT + SL_HIT + EXPIRED. Win = R > 0. Win rate, expectancy (mean R), profit factor (Σ win R / Σ |loss R|, null with no losses), total R, avg win/loss, max drawdown of cumulative R in resolution order. Breakdowns by model family (dated snapshots folded), asset, timeframe, confidence band; calibration = realized win rate vs average stated confidence per band.

## Surfaces

- Tick: `evaluatePendingSignals()` (lib/eval/job.ts) runs inside `runTick()`; result in `tick.last.signals`.
- `/performance` (server-rendered, URL filters: period / asset / timeframe / model), `GET /api/performance`.
- Archive cards show an outcome badge (`ArchivedSignal.evaluation`).
- `archiveAnalysis` now stores the analysed timeframe, not the model's free-text echo of it.
