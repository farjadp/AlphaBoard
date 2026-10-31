/**
 * Strategy Lab — the CSV written by the ExportM1.mq5 script (broker M1 bars, UTC):
 *   utc,open,high,low,close,spread_points,point,symbol=<broker symbol>
 * spread = spread_points × point (price units). Duplicate times are dropped; time going backwards is an error.
 */
import { makeBars, type Bars } from "../bars";
import { LabDataError } from "./encode";

export function parseMt5Csv(text: string): { symbol: string; bars: Bars; spread: Float64Array } {
  const lines = text.split(/\r?\n/);
  const head = lines[0]?.trim() ?? "";
  if (!head.startsWith("utc,open,high,low,close,spread_points,point")) {
    throw new LabDataError("this is not an ExportM1 file (expected the header utc,open,high,low,close,spread_points,point,symbol=…)");
  }
  const symbol = /symbol=([^,\s]+)/.exec(head)?.[1] ?? "unknown";
  const rows: Array<[number, number, number, number, number]> = [];
  const spread: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = line.split(",").map(Number);
    if (f.length < 7 || f.slice(0, 7).some((x) => !Number.isFinite(x))) throw new LabDataError(`line ${i + 1} is not a valid bar: "${line.slice(0, 80)}"`);
    const t = f[0] * 1000;
    if (t === last) continue;
    if (t < last) throw new LabDataError(`line ${i + 1}: time goes backwards`);
    last = t;
    rows.push([t, f[1], f[2], f[3], f[4]]);
    spread.push(f[5] * f[6]);
  }
  if (!rows.length) throw new LabDataError("the file has no bars");
  return { symbol, bars: makeBars(rows), spread: Float64Array.from(spread) };
}
