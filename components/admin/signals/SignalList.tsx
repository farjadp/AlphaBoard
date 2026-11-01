"use client";

import { useState } from "react";
import { displaySymbol } from "@/lib/signalDesk/format";
import { num } from "@/lib/signalDesk/num";
import { fmtR } from "@/lib/signalDesk/state";
import { btnQuiet, signalsRes, type LegDto, type SignalDto } from "./resources";

export type { SignalDto };

const STATUS: Record<SignalDto["status"], { text: string; cls: string }> = {
  PENDING: { text: "Waiting for terminal", cls: "bg-amber-soft text-amber" },
  SENT: { text: "Sent to terminal", cls: "bg-amber-soft text-amber" },
  OPEN: { text: "Open", cls: "bg-accent-soft text-accent" },
  CLOSED: { text: "Closed", cls: "bg-wash text-ink-2" },
  REJECTED: { text: "Rejected", cls: "bg-down-soft text-down" },
  EXPIRED: { text: "Expired", cls: "bg-wash text-ink-3" },
  CANCELLED: { text: "Cancelled", cls: "bg-wash text-ink-3" },
  UNKNOWN: { text: "No word from MT5", cls: "bg-down-soft text-down" },
};

const LEG: Record<LegDto["status"], string> = { OPEN: "open", TP: "target", SL: "stop", CLOSED: "closed" };
const COMMAND: Record<string, string> = { CLOSE_ALL: "Close all", BREAKEVEN: "Stop to entry", MOVE_SL: "Move stop", MOVE_TP: "Move target", CLOSE_PARTIAL: "Partial close" };
const pendingText = (p: string) => { const [c, ...a] = p.split("|"); return `${COMMAND[c] ?? c}${a.length ? ` (${a.join(" / ")})` : ""}`; };
const time = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC`;

/** Volume-weighted R of a signal whose legs are all closed; null while any leg is open. */
function result(legs: LegDto[]) {
  if (!legs.length || legs.some((l) => l.status === "OPEN" || l.r == null)) return null;
  const v = legs.reduce((a, l) => a + l.volume, 0);
  return Math.round((legs.reduce((a, l) => a + (l.r ?? 0) * l.volume, 0) / v) * 100) / 100;
}

export function SignalList({ signals, error, loaded, channelUsername }: { signals: SignalDto[]; error: string | null; loaded: boolean; channelUsername: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  type Cmd = { command: "CANCEL" | "CLOSE_ALL" | "BREAKEVEN" } | { command: "MOVE_SL"; price: number } | { command: "MOVE_TP"; leg: number; price: number } | { command: "CLOSE_PARTIAL"; fraction: number };
  const askNumber = (label: string, fallback = "") => { const v = window.prompt(label, fallback); if (v == null) return null; const n = Number(v.replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : NaN; };
  async function command(s: SignalDto, kind: Cmd["command"]) {
    const name = displaySymbol(s.symbol);
    let cmd: Cmd;
    if (kind === "MOVE_SL") { const price = askNumber(`New stop for every open ${name} position (current signal stop ${s.stop}):`); if (price == null) return; if (Number.isNaN(price)) { setMsg("Enter a price"); return; } cmd = { command: "MOVE_SL", price }; }
    else if (kind === "MOVE_TP") {
      const open = s.legs.filter((l) => l.status === "OPEN");
      const leg = open.length === 1 ? open[0].leg : askNumber(`Which leg? (open: ${open.map((l) => l.leg).join(", ")})`, String(open[0]?.leg ?? 1));
      if (leg == null) return; if (Number.isNaN(leg)) { setMsg("Enter a leg number"); return; }
      const price = askNumber(`New target for leg ${leg} of ${name}:`, String(open.find((l) => l.leg === leg)?.tp ?? "")); if (price == null) return; if (Number.isNaN(price)) { setMsg("Enter a price"); return; }
      cmd = { command: "MOVE_TP", leg, price };
    }
    else if (kind === "CLOSE_PARTIAL") { const pctv = askNumber(`Close what percent of every open ${name} position? (1–99)`, "50"); if (pctv == null) return; if (Number.isNaN(pctv) || pctv >= 100) { setMsg("Enter 1–99"); return; } cmd = { command: "CLOSE_PARTIAL", fraction: pctv / 100 }; }
    else {
      const ask = kind === "CLOSE_ALL" ? `Close every open position of this ${name} signal at market?` : kind === "BREAKEVEN" ? `Move the stop of every open ${name} position to its entry?` : null;
      if (ask && !window.confirm(ask)) return;
      cmd = { command: kind };
    }
    setBusy(s.id); setMsg(null);
    try {
      const res = await fetch(`/api/signal-desk/${encodeURIComponent(s.id)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (HTTP ${res.status})`);
      await signalsRes.load(true);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="sd-list" className="panel space-y-4 p-5">
      <h2 id="sd-list" className="font-display text-lg font-bold text-ink">Signals</h2>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      {msg && <p role="alert" className="text-sm text-down">{msg}</p>}
      {loaded && !signals.length && <p className="text-sm text-ink-2">No signals yet. The first one you send shows up here with its fills, targets and result.</p>}

      <ul className="divide-y divide-line">
        {signals.map((s) => {
          const st = STATUS[s.status];
          const r = s.status === "CLOSED" ? result(s.legs) : null;
          const link = channelUsername && s.channelMessageId != null ? `https://t.me/${channelUsername}/${s.channelMessageId}` : null;
          return (
            <li key={s.id} className="space-y-2 py-4 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`text-sm font-bold ${s.side === "BUY" ? "text-up" : "text-down"}`}>{s.side === "BUY" ? "Long" : "Short"}</span>
                <span className="font-bold text-ink">{displaySymbol(s.symbol)}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${st.cls}`}>{st.text}</span>
                {r != null && <span className={`num text-sm font-bold ${r > 0 ? "text-up" : r < 0 ? "text-down" : "text-ink-2"}`}>{fmtR(r)}</span>}
                <span className="text-xs text-ink-3">{time(s.createdAt)}</span>
                {!s.execute && <span className="text-xs text-ink-3">channel only</span>}
                {s.source && <span className="text-xs text-ink-3">from {s.source}</span>}
              </div>
              <p className="num text-sm text-ink-2">
                Entry {s.entry == null ? "market" : num(s.entry)} · Stop {num(s.stop)}
                {s.tps.length > 0 && <> · {s.tps.map((tp, i) => `TP${i + 1} ${num(tp)}`).join(" · ")}</>} · {num(s.riskPct)}%
              </p>
              {s.legs.length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {s.legs.map((l) => (
                    <li key={l.leg} className="text-ink-2">
                      <span className="font-semibold text-ink">Leg {l.leg}</span> <span className="num">{num(l.volume)}</span> lot · {LEG[l.status]}
                      {l.r != null && <span className={`num ml-1 ${l.r > 0 ? "text-up" : l.r < 0 ? "text-down" : ""}`}>{fmtR(l.r)}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {s.statusReason && <p className="text-sm text-ink-2">{s.statusReason}</p>}
              {s.pendingCommand && <p className="text-sm text-amber">{pendingText(s.pendingCommand)} is waiting for the terminal</p>}
              {s.channelError && <p className="text-sm text-down">Channel: {s.channelError}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {s.status === "PENDING" && <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => command(s, "CANCEL")}>Cancel</button>}
                {s.status === "OPEN" && (
                  <>
                    <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => command(s, "BREAKEVEN")}>Stop to entry</button>
                    <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => command(s, "MOVE_SL")}>Move stop…</button>
                    <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => command(s, "MOVE_TP")}>Move target…</button>
                    <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => command(s, "CLOSE_PARTIAL")}>Close part…</button>
                    <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => command(s, "CLOSE_ALL")}>Close all</button>
                  </>
                )}
                {link && <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent hover:underline">View in channel ↗</a>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
