import { badRequest } from "@/lib/http/errors";
import { num } from "./num";

/**
 * Signal Desk ⇄ SignalCopier.mq5 protocol (P12). MQL5 has no JSON parser, so jobs go out as `|`-separated lines
 * and reports come back form-encoded. `-` stands for "none"; numbers use `.` and carry no float noise.
 */
export type Command =
  | { command: "CLOSE_ALL" | "BREAKEVEN" }
  /** Every open leg's stop → price (the EA refuses a stop that loosens or sits on the wrong side of the market). */
  | { command: "MOVE_SL"; price: number }
  /** One leg's target → price. */
  | { command: "MOVE_TP"; leg: number; price: number }
  /** Close this fraction (0 < f < 1) of every open leg at market. */
  | { command: "CLOSE_PARTIAL"; fraction: number };

export type Job =
  | { kind: "OPEN"; id: string; symbol: string; side: "BUY" | "SELL"; entry: number | null; stop: number; maxDeviation: number | null; riskPct: number; tps: number[] }
  | ({ kind: "CMD"; id: string } & Command);

export type ReportEvent =
  | { event: "FILLED"; leg: number; ticket: string; volume: number; price: number; tp: number | null }
  | { event: "TP" | "SL" | "CLOSED"; leg: number; price: number }
  | { event: "BE" | "SL_MOVED"; price: number }
  | { event: "TP_MOVED"; leg: number; price: number }
  /** Part of a leg closed at market: the volume that went and the volume still open. */
  | { event: "PARTIAL"; leg: number; price: number; volume: number; left: number }
  | { event: "REJECTED" | "DRY_RUN"; reason: string };

/** `pendingCommand` column ⇄ Command: "MOVE_SL|2345.5", "MOVE_TP|2|2360", "CLOSE_PARTIAL|0.5", "CLOSE_ALL". */
export function encodeCommand(c: Command): string {
  switch (c.command) {
    case "MOVE_SL": return `MOVE_SL|${num(c.price)}`;
    case "MOVE_TP": return `MOVE_TP|${c.leg}|${num(c.price)}`;
    case "CLOSE_PARTIAL": return `CLOSE_PARTIAL|${num(c.fraction)}`;
    default: return c.command;
  }
}

export function decodeCommand(s: string): Command | null {
  const f = s.split("|");
  const n = (x: string | undefined) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : null; };
  if (f[0] === "CLOSE_ALL" || f[0] === "BREAKEVEN") return f.length === 1 ? { command: f[0] } : null;
  if (f[0] === "MOVE_SL") { const price = n(f[1]); return f.length === 2 && price ? { command: "MOVE_SL", price } : null; }
  if (f[0] === "MOVE_TP") { const leg = n(f[1]), price = n(f[2]); return f.length === 3 && leg && Number.isInteger(leg) && price ? { command: "MOVE_TP", leg, price } : null; }
  if (f[0] === "CLOSE_PARTIAL") { const fr = n(f[1]); return f.length === 2 && fr && fr < 1 ? { command: "CLOSE_PARTIAL", fraction: fr } : null; }
  return null;
}

const opt = (x: number | null) => (x == null ? "-" : num(x));

function field(s: string) {
  if (/[|\r\n,]/.test(s)) throw new Error(`invalid wire field: ${JSON.stringify(s)}`);
  return s;
}

export function encodeJobs(jobs: Job[]): string {
  return jobs
    .map((j) =>
      j.kind === "CMD"
        ? `CMD|${field(j.id)}|${encodeCommand(j)}`
        : ["OPEN", field(j.id), field(j.symbol), j.side, opt(j.entry), num(j.stop), opt(j.maxDeviation), num(j.riskPct), j.tps.length ? j.tps.map(num).join(",") : "-"].join("|"),
    )
    .join("\n");
}

function positive(body: URLSearchParams, key: string): number {
  const raw = body.get(key)?.trim() ?? "";
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) throw badRequest(`${key} must be a positive number`);
  return n;
}

function legOf(body: URLSearchParams): number {
  const n = positive(body, "leg");
  if (!Number.isInteger(n)) throw badRequest("leg must be a positive integer");
  return n;
}

/** An EA report body → typed event; 400 on anything malformed. */
export function parseReport(body: URLSearchParams): ReportEvent {
  const event = body.get("event");
  switch (event) {
    case "FILLED": {
      const ticket = body.get("ticket")?.trim() ?? "";
      if (!/^\d{1,20}$/.test(ticket)) throw badRequest("ticket must be a number");
      const tp = body.get("tp")?.trim();
      return { event, leg: legOf(body), ticket, volume: positive(body, "volume"), price: positive(body, "price"), tp: tp ? positive(body, "tp") : null };
    }
    case "TP": case "SL": case "CLOSED":
      return { event, leg: legOf(body), price: positive(body, "price") };
    case "BE": case "SL_MOVED":
      return { event, price: positive(body, "price") };
    case "TP_MOVED":
      return { event, leg: legOf(body), price: positive(body, "price") };
    case "PARTIAL": {
      const rawLeft = body.get("left")?.trim() ?? "";
      const left = Number(rawLeft);
      if (!rawLeft || !Number.isFinite(left) || left < 0) throw badRequest("left must be a non-negative number");
      return { event, leg: legOf(body), price: positive(body, "price"), volume: positive(body, "volume"), left };
    }
    case "REJECTED": case "DRY_RUN": {
      const reason = body.get("reason")?.trim().slice(0, 200) ?? "";
      if (!reason) throw badRequest("reason is required");
      return { event, reason };
    }
    default:
      throw badRequest("unknown event");
  }
}
