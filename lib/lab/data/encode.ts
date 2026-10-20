/** Strategy Lab — compact storage of a bar series: gzip of little-endian Float64 columns. */
import { gunzipSync, gzipSync } from "node:zlib";
import type { Bars } from "../bars";

export class LabDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabDataError";
  }
}

const MAGIC = 0x4c41_4231; // "LAB1"

/** Header: magic, bar count, column count (5 or 6), then the columns t, o, h, l, c[, spread]. */
export function encodeSeries(bars: Bars, spread?: Float64Array | null): Buffer {
  const n = bars.t.length;
  const cols = [bars.t, bars.o, bars.h, bars.l, bars.c, ...(spread ? [spread] : [])];
  const out = Buffer.alloc(12 + cols.length * n * 8);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(n, 4);
  out.writeUInt32LE(cols.length, 8);
  cols.forEach((c, k) => {
    if (c.length !== n) throw new LabDataError("columns of different length");
    for (let i = 0; i < n; i++) out.writeDoubleLE(c[i], 12 + (k * n + i) * 8);
  });
  return gzipSync(out, { level: 6 });
}

export function decodeSeries(buf: Buffer): { bars: Bars; spread: Float64Array | null } {
  let raw: Buffer;
  try {
    raw = gunzipSync(buf);
  } catch {
    throw new LabDataError("stored series is not readable");
  }
  if (raw.length < 12 || raw.readUInt32LE(0) !== MAGIC) throw new LabDataError("stored series has an unknown format");
  const n = raw.readUInt32LE(4);
  const k = raw.readUInt32LE(8);
  if ((k !== 5 && k !== 6) || raw.length !== 12 + k * n * 8) throw new LabDataError("stored series is truncated");
  const col = (j: number) => {
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = raw.readDoubleLE(12 + (j * n + i) * 8);
    return a;
  };
  return { bars: { t: col(0), o: col(1), h: col(2), l: col(3), c: col(4) }, spread: k === 6 ? col(5) : null };
}
