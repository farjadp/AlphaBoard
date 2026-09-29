/** Small numeric helpers for the risk engine (pure). */

/** Round a quantity down to the venue's step, tolerating float noise (0.3 / 0.1 stays 3 steps). */
export function floorToStep(qty: number, step: number): number {
  if (!(step > 0)) return qty;
  const steps = Math.floor(qty / step + 1e-9);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((steps * step).toFixed(Math.min(decimals, 12)));
}

/** Price-aware formatting for reasons shown in the room. */
export function fmt(n: number, digits = 6): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
