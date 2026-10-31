/**
 * The desk as an actual round table: seats positioned around an oval, with a thread drawn between
 * whoever has spoken this cycle in order. Wider screens only — components/sessions/DeskTable.tsx
 * is the grid fallback for narrow viewports, shown alongside this one and switched by CSS, not JS,
 * so there is no hydration mismatch from measuring the viewport on the client.
 */
import type { Mandate } from "@/lib/sessions/mandate";
import { deriveSeats, speakOrder, SEAT_STAGE, STAGE_LABEL, type Seat } from "@/lib/sessions/seats";
import type { SeatRole } from "@/lib/agents/cast";
import type { SessionMessageDto } from "@/lib/types/sessions";

/** Logical box the seats and the connecting lines are laid out in; the container keeps this
 * aspect ratio via `aspect-[680/380]`, so percentages below line up with the SVG's own viewBox. */
const BOX = { w: 680, h: 380 };
const CENTER = { x: 340, y: 205 };
const R = 27;

const SEAT_XY: Record<SeatRole, { x: number; y: number }> = {
  STRATEGIST: { x: 340, y: 55 },
  MARKET: { x: 120, y: 122 },
  NEWS: { x: 560, y: 122 },
  BULL: { x: 62, y: 205 },
  BEAR: { x: 618, y: 205 },
  RISK: { x: 120, y: 288 },
  JOURNAL: { x: 560, y: 288 },
  EXECUTOR: { x: 340, y: 325 },
};

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/** Shortens a line from `a` to `b` so it stops at each endpoint's circle edge, not its center. */
function trimmed(a: { x: number; y: number }, b: { x: number; y: number }, ra: number, rb: number) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  return { x1: a.x + (dx * ra) / len, y1: a.y + (dy * ra) / len, x2: b.x - (dx * rb) / len, y2: b.y - (dy * rb) / len };
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

function Seat({ s }: { s: Seat }) {
  const dashed = s.state === "idle" || s.state === "waiting";
  return (
    <div
      title={`${s.name} — ${s.blurb}`}
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
      style={{ left: pct(SEAT_XY[s.role].x, BOX.w), top: pct(SEAT_XY[s.role].y, BOX.h) }}
    >
      <span
        aria-hidden
        className={`grid size-12 shrink-0 place-items-center rounded-full border text-xs font-bold ${s.tone.badge}
          ${s.speaking ? "border-2 border-ink" : dashed ? "border-dashed border-line-2" : "border-line"}
          ${s.state === "thinking" ? "animate-pulse motion-reduce:animate-none" : ""}`}
      >
        {s.badge}
      </span>
      <span className="whitespace-nowrap text-[11px] font-medium text-ink">{s.name}</span>
      <span className={`whitespace-nowrap text-[10px] ${s.state === "waiting" ? "text-amber" : "text-ink-3"}`}>
        {s.state === "thinking" ? "thinking…" : s.state === "waiting" ? "no answer yet" : s.meta ?? s.state}
      </span>
    </div>
  );
}

export default function DeskRoundTable({ messages, mandate, now }: { messages: SessionMessageDto[]; mandate: Mandate; now: number }) {
  const seats = deriveSeats(messages, { debate: mandate.debate, now });
  const cycle = seats[0]?.cycle ?? null;
  const order = cycle == null ? [] : speakOrder(messages, cycle);
  const speaker = seats.find((s) => s.speaking && s.lastBody);
  const reachedStage = order.length ? Math.max(...order.map((r) => SEAT_STAGE[r])) : -1;

  const lines = order.map((role, i) => {
    const to = SEAT_XY[role];
    const parallel = i === 0 && SEAT_STAGE[role] === 0;
    const prevRole = i > 0 ? order[i - 1] : null;
    // Parallel analysts both thread from the table's centre rather than from each other; every
    // later seat threads from whoever spoke immediately before it.
    const from = parallel || !prevRole ? CENTER : SEAT_XY[prevRole];
    const last = i === order.length - 1;
    return { ...trimmed(from, to, parallel || !prevRole ? 0 : R, R), last, key: `${role}-${i}` };
  });

  return (
    <div>
      <div className="relative mx-auto aspect-[680/380] w-full max-w-[560px]">
        <div className="absolute inset-6 rounded-[50%] border border-line-2 bg-wash" />
        <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} className="absolute inset-0 h-full w-full" aria-hidden>
          {lines.map((l) => (
            <line
              key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeWidth={l.last ? 1.5 : 0.75}
              className={l.last ? "stroke-ink/60" : "stroke-ink/15"}
            />
          ))}
        </svg>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-sm font-semibold text-ink">{cycle == null ? "no cycle yet" : `cycle ${cycle}`}</p>
          {!mandate.debate && <p className="mt-0.5 text-[10px] text-ink-3">debate off</p>}
        </div>
        {seats.map((s) => <Seat key={s.role} s={s} />)}
      </div>

      <ul aria-label="Cycle stages" className="mt-3 flex flex-wrap justify-center gap-1.5">
        {STAGE_LABEL.map((label, stage) => (
          <li
            key={label}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              stage === reachedStage ? "border-ink/30 bg-ink/[0.06] font-medium text-ink" : stage < reachedStage ? "border-line text-ink-2" : "border-line text-ink-3"
            }`}
          >
            {label}
          </li>
        ))}
      </ul>

      <div aria-live="polite" className="mt-3 rounded-xl border border-line bg-paper p-3">
        {speaker ? (
          <>
            <p className="text-xs">
              <span className="font-semibold text-ink">{speaker.name}</span>
              {speaker.lastAt && <time className="num ml-2 text-ink-3" dateTime={speaker.lastAt}>{hhmm(speaker.lastAt)}</time>}
            </p>
            <p className="mt-1 line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-ink-2">{speaker.lastBody}</p>
          </>
        ) : <p className="text-sm text-ink-3">Nobody has spoken this cycle yet.</p>}
      </div>
    </div>
  );
}
