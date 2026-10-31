/**
 * MT5 deal history (the ExportDeals.mq5 CSV) → positions (pure).
 * A position is every deal sharing a position id: the opening deal sets side, entry price, stop and time;
 * closing deals (out / out_by / the closing half of an inout) set the volume-weighted exit. Net result =
 * profit + swap + commission + fee of all its deals, in the account currency.
 */
export interface Deal {
  deal: number; order: number; position: number; time: number;
  side: "BUY" | "SELL"; entry: "IN" | "OUT" | "INOUT" | "OUT_BY";
  symbol: string; volume: number; price: number; sl: number; tp: number;
  commission: number; swap: number; profit: number; fee: number; magic: number; comment: string;
}

export interface Mt5Position {
  position: number;
  symbol: string;
  side: "LONG" | "SHORT";
  volume: number;
  entryPrice: number;
  exitPrice: number | null;
  initialStop: number | null;
  openedAt: number;
  closedAt: number | null;
  closed: boolean;
  net: number;
  magic: number;
  /** Opened by hand (magic 0) rather than by an expert. */
  manual: boolean;
}

export class DealsFileError extends Error {
  constructor(message: string) { super(message); this.name = "DealsFileError"; }
}

const ENTRY = ["IN", "OUT", "INOUT", "OUT_BY"] as const;

export function parseDealsCsv(text: string): { login: string; currency: string; deals: Deal[] } {
  const lines = text.split(/\r?\n/);
  const head = lines[0]?.trim() ?? "";
  if (!head.startsWith("deal,order,position,time_utc,type,entry,symbol")) throw new DealsFileError("this is not an ExportDeals file (expected the header deal,order,position,time_utc,…)");
  const login = /login=([^,\s]+)/.exec(head)?.[1] ?? "unknown";
  const currency = /currency=([^,\s]+)/.exec(head)?.[1] ?? "";
  const deals: Deal[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = line.split(",");
    const n = (k: number) => Number(f[k]);
    if (f.length < 16 || [0, 2, 3, 4, 5, 7, 8].some((k) => !Number.isFinite(n(k)))) throw new DealsFileError(`line ${i + 1} is not a valid deal`);
    deals.push({
      deal: n(0), order: n(1), position: n(2), time: n(3) * 1000, side: n(4) === 0 ? "BUY" : "SELL", entry: ENTRY[n(5)] ?? "IN",
      symbol: f[6], volume: n(7), price: n(8), sl: n(9) || 0, tp: n(10) || 0, commission: n(11) || 0, swap: n(12) || 0,
      profit: n(13) || 0, fee: n(14) || 0, magic: n(15) || 0, comment: f.slice(16).join(","),
    });
  }
  return { login, currency, deals };
}

export function positionsFromDeals(deals: Deal[]): Mt5Position[] {
  const byPos = new Map<number, Deal[]>();
  for (const d of [...deals].sort((a, b) => a.time - b.time || a.deal - b.deal)) {
    const list = byPos.get(d.position) ?? [];
    list.push(d);
    byPos.set(d.position, list);
  }
  const out: Mt5Position[] = [];
  for (const [position, list] of byPos) {
    const open = list.find((d) => d.entry === "IN") ?? list[0];
    const side: "LONG" | "SHORT" = open.side === "BUY" ? "LONG" : "SHORT";
    let openVol = 0;
    let closeVol = 0;
    let closeValue = 0;
    let closedAt: number | null = null;
    let net = 0;
    for (const d of list) {
      net += d.profit + d.swap + d.commission + d.fee;
      // Hedging accounts only produce IN and OUT / OUT_BY; an INOUT (netting reversal) is counted as a close.
      if (d.entry === "IN") openVol += d.volume;
      else { closeVol += d.volume; closeValue += d.volume * d.price; closedAt = d.time; }
    }
    const closed = openVol > 0 && closeVol >= openVol - 1e-9;
    out.push({
      position, symbol: open.symbol, side, volume: openVol || open.volume, entryPrice: open.price,
      exitPrice: closeVol > 0 ? closeValue / closeVol : null, initialStop: open.sl > 0 ? open.sl : null,
      openedAt: open.time, closedAt: closed ? closedAt : null, closed, net, magic: open.magic, manual: open.magic === 0,
    });
  }
  return out.sort((a, b) => a.openedAt - b.openedAt);
}
