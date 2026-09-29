/**
 * Stock-exchange sessions laid out on the viewer's own calendar day, for the 24h session band.
 * Pure: the caller passes "now" and the start of the viewer's local day.
 */

export interface SessionSpec {
  key: "sydney" | "tokyo" | "london" | "newyork";
  city: string;
  tz: string;
  /** Local exchange hours [openH, openM, closeH, closeM]. */
  hours: [number, number, number, number];
}

export const SESSIONS: SessionSpec[] = [
  { key: "sydney", city: "Sydney", tz: "Australia/Sydney", hours: [10, 0, 16, 0] },
  { key: "tokyo", city: "Tokyo", tz: "Asia/Tokyo", hours: [9, 0, 15, 30] },
  { key: "london", city: "London", tz: "Europe/London", hours: [8, 0, 16, 30] },
  { key: "newyork", city: "New York", tz: "America/New_York", hours: [9, 30, 16, 0] },
];

export interface SessionState {
  key: SessionSpec["key"];
  city: string;
  isOpen: boolean;
  /** Fractions [0..1] of the viewer's day covered by this session (a session can wrap midnight). */
  segments: Array<{ start: number; end: number }>;
  /** Local exchange hours, e.g. "09:30–16:00". */
  hoursLabel: string;
  /** "closes in 2h 9m" / "opens in 45m" / "opens Mon 09:30". */
  status: string;
  /** Milliseconds until the next open (closed) or close (open). */
  msToChange: number;
}

const DAY_MS = 86_400_000;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function offsetMinutes(tz: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  return (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function datePartsIn(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month") - 1, d: get("day") };
}

/** UTC instant of a wall-clock time in a zone (re-checks the offset once for DST edges). */
function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m, d, h, min);
  let ts = guess - offsetMinutes(tz, new Date(guess)) * 60_000;
  ts = guess - offsetMinutes(tz, new Date(ts)) * 60_000;
  return ts;
}

function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Trading windows of one exchange around `now`, weekends (in the exchange's zone) excluded. */
function windows(spec: SessionSpec, around: Date): Array<{ open: number; close: number; weekday: number }> {
  const [oh, om, ch, cm] = spec.hours;
  const base = datePartsIn(spec.tz, around);
  const out: Array<{ open: number; close: number; weekday: number }> = [];
  for (let k = -2; k <= 7; k++) {
    const day = new Date(Date.UTC(base.y, base.m, base.d + k));
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
    out.push({ open: zonedToUtc(y, m, d, oh, om, spec.tz), close: zonedToUtc(y, m, d, ch, cm, spec.tz), weekday });
  }
  return out;
}

export function marketSessions(now: Date, dayStart: Date): SessionState[] {
  const t = now.getTime();
  const d0 = dayStart.getTime();
  return SESSIONS.map((spec) => {
    const wins = windows(spec, now);
    const segments = wins
      .map((w) => ({ start: Math.max(w.open, d0), end: Math.min(w.close, d0 + DAY_MS) }))
      .filter((s) => s.end > s.start)
      .map((s) => ({ start: (s.start - d0) / DAY_MS, end: (s.end - d0) / DAY_MS }))
      .sort((a, b) => a.start - b.start);

    const current = wins.find((w) => t >= w.open && t < w.close);
    const next = wins.find((w) => w.open > t);
    const [oh, om, ch, cm] = spec.hours;
    let status: string;
    let msToChange: number;
    if (current) {
      msToChange = current.close - t;
      status = `closes in ${fmtDuration(msToChange)}`;
    } else if (next) {
      msToChange = next.open - t;
      status = msToChange < 24 * 3_600_000
        ? `opens in ${fmtDuration(msToChange)}`
        : `opens ${DAY_NAMES[next.weekday]} ${pad(oh)}:${pad(om)}`;
    } else {
      msToChange = Infinity;
      status = "closed";
    }
    return {
      key: spec.key, city: spec.city, isOpen: Boolean(current), segments,
      hoursLabel: `${pad(oh)}:${pad(om)}–${pad(ch)}:${pad(cm)}`, status, msToChange,
    };
  });
}

/** One line for the header: which markets are open and what changes next. */
export function sessionHeadline(sessions: SessionState[]): string {
  const open = sessions.filter((s) => s.isOpen);
  if (open.length > 0) {
    const soonest = open.reduce((a, b) => (b.msToChange < a.msToChange ? b : a));
    const names = open.map((s) => s.city);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
    return `${list} open · ${soonest.city} ${soonest.status}`;
  }
  const next = sessions.reduce((a, b) => (b.msToChange < a.msToChange ? b : a));
  return `Stock markets closed · ${next.city} ${next.status}`;
}
