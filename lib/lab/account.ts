/**
 * Strategy Lab — a sequential account with money management (pure).
 *
 * Entries come in time order. A set is taken when a slot is free and no guard blocks it; it risks
 * `riskPct / slots` of the realized balance at entry (its worst case = that amount). Results are settled
 * when the next entry is considered after their exit, so guards see every close that happened before it.
 * Guards: daily loss lock (vs the UTC day's starting balance), stop for the day after N losses in a row,
 * cooldown after a losing close, optional martingale (shown as a warning case: risk ×2 after each loss).
 * The open-position drawdown uses each set's worst open P&L (`mae`) on top of the balance before it closed.
 */
import type { Bars } from "./bars";
import type { SetResult } from "./ladder";
import { perYearPct, profitFactor } from "./metrics";

export interface MoneyRules {
  /** Percent of the balance risked per slot group (split across `slots`). */
  riskPct: number;
  slots: number;
  /** Stop for the UTC day once the balance is this many percent under the day's start; null = off. */
  dailyLossPct: number | null;
  /** Stop for the UTC day after this many losing closes in a row; 0 = off. */
  maxConsecLosses: number;
  /** No entry for this many minutes after a losing close; 0 = off. */
  cooldownMin: number;
  /** Double the risk after each loss (capped at 16×), reset after a win. Shown as the warning case. */
  martingale: boolean;
}

export interface AccountRun {
  finalBalance: number;
  returnPct: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  maxDdRealizedPct: number;
  maxDdMtmPct: number;
  perYear: Record<string, number>;
  /** [exit time ms, balance] after each close. */
  curve: Array<[number, number]>;
}

interface Pending { exit: number; pnlMoney: number; maeMoney: number }

export function runAccount(
  b: Bars,
  entries: ArrayLike<number>,
  dirOf: (i: number) => -1 | 0 | 1,
  sim: (i: number, dir: 1 | -1) => SetResult | null,
  rules: MoneyRules,
  start = 1000,
): AccountRun {
  let bal = start;
  let peak = start;
  let ddReal = 0;
  let ddMtm = 0;
  let day = -1;
  let dayStart = bal;
  let streak = 0;
  let stopped = false;
  let lastLossT = -Infinity;
  let mult = 1;
  let pending: Pending[] = [];
  const results: number[] = [];
  const curve: Array<[number, number]> = [];

  const settle = (upTo: number) => {
    const due = pending.filter((p) => p.exit < upTo).sort((a, c) => a.exit - c.exit);
    if (!due.length) return;
    pending = pending.filter((p) => p.exit >= upTo);
    for (const p of due) {
      if (peak > 0) ddMtm = Math.max(ddMtm, (peak - (bal + p.maeMoney)) / peak);
      bal += p.pnlMoney;
      results.push(p.pnlMoney);
      curve.push([b.t[p.exit], bal]);
      if (p.pnlMoney > 0) { streak = 0; mult = 1; }
      else if (p.pnlMoney < 0) {
        streak++;
        lastLossT = b.t[p.exit];
        if (rules.martingale) mult = Math.min(mult * 2, 16);
      }
      peak = Math.max(peak, bal);
      ddReal = Math.max(ddReal, (peak - bal) / peak);
      if (rules.maxConsecLosses > 0 && streak >= rules.maxConsecLosses) stopped = true;
      if (rules.dailyLossPct != null && bal <= dayStart * (1 - rules.dailyLossPct / 100)) stopped = true;
    }
  };

  for (let e = 0; e < entries.length; e++) {
    const i0 = entries[e];
    settle(i0);
    const t = b.t[i0];
    const d = Math.floor(t / 86_400_000);
    if (d !== day) { day = d; dayStart = bal; streak = 0; stopped = false; }
    if (stopped || pending.length >= rules.slots) continue;
    if (rules.cooldownMin > 0 && t - lastLossT < rules.cooldownMin * 60_000) continue;
    const dir = dirOf(i0);
    if (dir === 0) continue;
    const r = sim(i0, dir);
    if (!r) continue;
    const risk = Math.min((rules.riskPct / 100) * mult, 0.08) / rules.slots;
    const size = (bal * risk) / r.worst;
    pending.push({ exit: r.exit, pnlMoney: r.pnl * size, maeMoney: Math.min(0, r.mae) * size });
  }
  settle(Infinity);
  ddMtm = Math.max(ddMtm, ddReal);
  const wins = results.filter((x) => x > 0).length;
  return {
    finalBalance: bal,
    returnPct: (bal / start - 1) * 100,
    trades: results.length,
    winRate: results.length ? wins / results.length : null,
    profitFactor: profitFactor(results),
    maxDdRealizedPct: ddReal * 100,
    maxDdMtmPct: ddMtm * 100,
    perYear: perYearPct(curve, start),
    curve,
  };
}
