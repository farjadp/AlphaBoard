import { badRequest } from "@/lib/http/errors";
import { num } from "./num";

/**
 * Signal Desk ⇄ SignalCopier.mq5 protocol (P12). MQL5 has no JSON parser, so jobs go out as `|`-separated lines
 * and reports come back form-encoded. `-` stands for "none"; numbers use `.` and carry no float noise.
 */
export type Job =
  | { kind: "OPEN"; id: string; symbol: string; side: "BUY" | "SELL"; entry: number | null; stop: number; maxDeviation: number | null; riskPct: number; tps: number[] }
  | { kind: "CMD"; id: string; command: "CLOSE_ALL" | "BREAKEVEN" };

export type ReportEvent =
  | { event: "FILLED"; leg: number; ticket: string; volume: number; price: number; tp: number | null }
  | { event: "TP" | "SL" | "CLOSED"; leg: number; price: number }
  | { event: "BE"; price: number }
  | { event: "REJECTED" | "DRY_RUN"; reason: string };

const opt = (x: number | null) => (x == null ? "-" : num(x));

function field(s: string) {
  if (/[|\r\n,]/.test(s)) throw new Error(`invalid wire field: ${JSON.stringify(s)}`);
  return s;
}

export function encodeJobs(jobs: Job[]): string {
  return jobs
    .map((j) =>
      j.kind === "CMD"
        ? `CMD|${field(j.id)}|${j.command}`
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
    case "BE":
      return { event, price: positive(body, "price") };
    case "REJECTED": case "DRY_RUN": {
      const reason = body.get("reason")?.trim().slice(0, 200) ?? "";
      if (!reason) throw badRequest("reason is required");
      return { event, reason };
    }
    default:
      throw badRequest("unknown event");
  }
}
