"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/setup", label: "Setup" },
  { href: "/alerts", label: "Alerts" },
  { href: "/archive", label: "Archive" },
  { href: "/journal", label: "Journal" },
];

// [openH, openM, closeH, closeM] in local market time
const MARKET_HOURS: Record<string, [number, number, number, number]> = {
  "America/New_York": [9, 30, 16, 0],
  "Europe/London":    [8,  0, 16, 30],
  "Europe/Berlin":    [9,  0, 17, 30],
  "Asia/Dubai":       [10, 0, 14, 0],
  "Asia/Tokyo":       [9,  0, 15, 30],
  "Asia/Singapore":   [9,  0, 17, 0],
  "Australia/Sydney": [10, 0, 16, 0],
};

const CLOCKS = [
  { city: "New York",  tz: "America/New_York",  exchange: "NYSE"  },
  { city: "London",    tz: "Europe/London",      exchange: "LSE"   },
  { city: "Frankfurt", tz: "Europe/Berlin",      exchange: "XETRA" },
  { city: "Dubai",     tz: "Asia/Dubai",         exchange: "DFM"   },
  { city: "Tokyo",     tz: "Asia/Tokyo",         exchange: "TSE"   },
  { city: "Singapore", tz: "Asia/Singapore",     exchange: "SGX"   },
  { city: "Sydney",    tz: "Australia/Sydney",   exchange: "ASX"   },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function getLocalDate(tz: string, now: Date) {
  return new Date(now.toLocaleString("en-US", { timeZone: tz }));
}

function getTime(tz: string, now: Date) {
  return now.toLocaleTimeString("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function getOffsetMinutes(tz: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, timeZoneName: "shortOffset",
  }).formatToParts(now);
  const offsetStr = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3] ?? "0", 10));
}

function formatDiff(diffMins: number): string {
  if (diffMins === 0) return "local";
  const sign = diffMins > 0 ? "+" : "−";
  const abs = Math.abs(diffMins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${m}m`;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function fmtHM(h: number, m: number) { return `${pad(h)}:${pad(m)}`; }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface SessionInfo {
  isWeekend: boolean;
  isOpen: boolean;
  currentMins: number;
  openMins: number;
  closeMins: number;
  openLabel: string;
  closeLabel: string;
  statusText: string;
  progressPct: number;
}

function getSessionInfo(tz: string, now: Date): SessionInfo {
  const [oh, om, ch, cm] = MARKET_HOURS[tz] ?? [9, 0, 17, 30];
  const local = getLocalDate(tz, now);
  const day = local.getDay();
  const currentMins = local.getHours() * 60 + local.getMinutes();
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  const isWeekend = day === 0 || day === 6;
  const isOpen = !isWeekend && currentMins >= openMins && currentMins < closeMins;
  const openLabel = fmtHM(oh, om);
  const closeLabel = fmtHM(ch, cm);

  function fmtRemaining(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  let statusText = "";
  if (isWeekend) {
    const daysUntilMon = (8 - day) % 7 || 7;
    statusText = `opens ${DAY_NAMES[(day + daysUntilMon) % 7]} ${openLabel}`;
  } else if (isOpen) {
    const minsLeft = closeMins - currentMins;
    statusText = `closes in ${fmtRemaining(minsLeft)}`;
  } else if (currentMins < openMins) {
    const minsUntil = openMins - currentMins;
    statusText = `opens in ${fmtRemaining(minsUntil)}`;
  } else {
    const nextDay = DAY_NAMES[(day + 1) % 7];
    statusText = `opens ${nextDay} ${openLabel}`;
  }

  const sessionLen = closeMins - openMins;
  const progressPct = isOpen
    ? Math.min(100, Math.max(0, ((currentMins - openMins) / sessionLen) * 100))
    : 0;

  return { isWeekend, isOpen, currentMins, openMins, closeMins, openLabel, closeLabel, statusText, progressPct };
}

// ─── session bar component ─────────────────────────────────────────────────────

function SessionBar({ tz, now }: { tz: string; now: Date }) {
  const { isWeekend, isOpen, currentMins, openMins, closeMins } = getSessionInfo(tz, now);

  const BAR_W = 80;
  const openPct  = (openMins  / 1440) * 100;
  const closePct = (closeMins / 1440) * 100;
  const nowPct   = (currentMins / 1440) * 100;
  const sessionW = closePct - openPct;

  return (
    <div style={{ width: `${BAR_W}px`, position: "relative" }}>
      <div
        style={{
          height: "3px",
          borderRadius: "2px",
          background: "var(--border-strong)",
          position: "relative",
          overflow: "visible",
        }}
      >
        {!isWeekend && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: `${openPct}%`,
              width: `${sessionW}%`,
              height: "100%",
              borderRadius: "2px",
              background: isOpen ? "var(--green)" : "var(--text-3)",
              opacity: isOpen ? 0.8 : 0.3,
            }}
          />
        )}
        {isOpen && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: `${openPct}%`,
              width: `${((currentMins - openMins) / (closeMins - openMins)) * sessionW}%`,
              height: "100%",
              borderRadius: "2px",
              background: "var(--green)",
              boxShadow: "0 0 6px var(--green-glow)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: "-3px",
            left: `${nowPct}%`,
            transform: "translateX(-50%)",
            width: "2px",
            height: "9px",
            borderRadius: "1px",
            background: isOpen ? "var(--green)" : "var(--text-3)",
            boxShadow: isOpen ? "0 0 4px var(--green-glow)" : "none",
            zIndex: 2,
          }}
        />
      </div>
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export default function NavBar({ connected = true }: { connected?: boolean }) {
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);
  const [localTz, setLocalTz] = useState<string>("");
  const [localCity, setLocalCity] = useState<string>("");

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLocalTz(tz);
    const parts = tz.split("/");
    setLocalCity(parts[parts.length - 1].replace(/_/g, " "));
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const localOffsetMins = now && localTz ? getOffsetMinutes(localTz, now) : null;

  return (
    <header className="shrink-0" style={{ background: "var(--bg-2)" }}>
      {/* Main nav row */}
      <div
        className="flex items-center justify-between px-6 h-14 gradient-border"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-sm font-bold tracking-tight gradient-text">
          AlphaBoard
        </span>

        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="text-xs transition-all duration-200 px-3 py-1.5 rounded-lg"
                style={{
                  color: active ? "var(--text)" : "var(--text-3)",
                  fontWeight: active ? 600 : 400,
                  background: active ? "var(--surface-active)" : "transparent",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-3)" }}>
          <span
            className="w-2 h-2 rounded-full live-dot"
            style={{ background: connected ? "var(--green)" : "var(--text-3)" }}
          />
          <span style={{ color: connected ? "var(--green)" : "var(--text-3)", fontWeight: 500 }}>
            {connected ? "LIVE" : "connecting…"}
          </span>
        </div>
      </div>

      {/* Clock strip */}
      <div
        className="flex overflow-x-auto"
        style={{
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Local clock */}
        {now && localTz && (
          <div
            className="flex flex-col justify-center gap-1 px-5 py-2.5 shrink-0"
            style={{
              borderRight: "1px solid var(--border)",
              borderLeft: "2px solid var(--accent)",
              background: "var(--surface-2)",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                {localCity}
              </span>
              <span
                style={{
                  background: "var(--gradient-accent)",
                  color: "#fff",
                  fontSize: "9px",
                  lineHeight: "14px",
                  padding: "0 5px",
                  borderRadius: "4px",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                YOU
              </span>
            </div>
            <div className="text-xs font-medium tabular-nums" style={{ color: "var(--text)" }}>
              {getTime(localTz, now)}
            </div>
          </div>
        )}

        {/* Remote clocks */}
        {CLOCKS.map((c, i) => {
          if (!now) return null;
          const isLocal = localTz === c.tz;
          const time = getTime(c.tz, now);
          const session = getSessionInfo(c.tz, now);

          let diffLabel = "";
          if (localOffsetMins !== null) {
            const diff = getOffsetMinutes(c.tz, now) - localOffsetMins;
            diffLabel = isLocal ? "" : formatDiff(diff);
          }

          return (
            <div
              key={c.city}
              className="flex flex-col justify-center gap-1 px-4 py-2.5 shrink-0 transition-colors duration-150"
              style={{
                borderRight: i < CLOCKS.length - 1 ? "1px solid var(--border)" : "none",
                opacity: isLocal ? 0.35 : 1,
                minWidth: "120px",
              }}
              onMouseEnter={(e) => { if (!isLocal) e.currentTarget.style.background = "var(--surface-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  {c.city}
                </span>
                {diffLabel && (
                  <span style={{ fontSize: "10px", color: "var(--text-3)" }}>
                    {diffLabel}
                  </span>
                )}
              </div>

              <div className="text-xs tabular-nums font-medium" style={{ color: "var(--text)" }}>
                {time}
              </div>

              <SessionBar tz={c.tz} now={now} />

              <div className="flex items-center justify-between" style={{ width: "80px" }}>
                <span style={{ fontSize: "9px", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                  {session.openLabel}
                </span>
                <span style={{ fontSize: "9px", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                  {session.closeLabel}
                </span>
              </div>

              <div
                style={{
                  fontSize: "9px",
                  color: session.isOpen ? "var(--green)" : "var(--text-3)",
                  whiteSpace: "nowrap",
                  fontWeight: session.isOpen ? 500 : 400,
                }}
              >
                {session.isWeekend && (
                  <span style={{ marginRight: "4px", color: "var(--yellow)" }}>WKD</span>
                )}
                {session.statusText}
              </div>
            </div>
          );
        })}
      </div>
    </header>
  );
}
