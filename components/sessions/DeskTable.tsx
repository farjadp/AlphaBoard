import type { Mandate } from "@/lib/sessions/mandate";
import { deriveSeats, type Seat } from "@/lib/sessions/seats";
import type { SeatRole } from "@/lib/agents/cast";
import type { SessionMessageDto } from "@/lib/types/sessions";

/** Where each seat sits once there is room for a table; below sm the seats stack in cycle order. */
const POS: Record<SeatRole, string> = {
  MARKET: "sm:col-start-1 sm:row-start-1",
  NEWS: "sm:col-start-3 sm:row-start-1",
  BULL: "sm:col-start-1 sm:row-start-2",
  BEAR: "sm:col-start-3 sm:row-start-2",
  STRATEGIST: "sm:col-start-2 sm:row-start-3",
  RISK: "sm:col-start-1 sm:row-start-4",
  EXECUTOR: "sm:col-start-2 sm:row-start-4",
  JOURNAL: "sm:col-start-3 sm:row-start-4",
};

/** AI spend is fractions of a cent per call, so the shared usd() 2-decimal format would read $0.00. */
const ai = (n: number) => `$${n.toFixed(4)}`;

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

/** The seat's third line: what it found, or what it is doing while it has nothing to report. */
function stateLine(s: Seat) {
  if (s.state === "thinking") return { text: "thinking…", tone: "text-ink-3" };
  if (s.state === "waiting") return { text: "no answer yet", tone: "text-amber" };
  if (s.meta) return { text: s.meta, tone: s.speaking ? "text-ink" : "text-ink-2" };
  if (s.state === "speaking") return { text: "speaking now", tone: "text-ink" };
  if (s.state === "done") return { text: "done", tone: "text-ink-3" };
  return { text: "idle", tone: "text-ink-3" };
}

function SeatCard({ s, model }: { s: Seat; model: string }) {
  const line = stateLine(s);
  return (
    <li
      title={`${s.name} — ${s.blurb} (${model})`}
      className={`rounded-xl border p-2.5 ${POS[s.role]} ${s.tone.fill} ${s.speaking ? "border-ink/40" : s.state === "idle" ? "border-dashed border-line-2" : "border-line"}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${s.tone.badge}`}>{s.badge}</span>
        <span className="truncate text-sm font-semibold text-ink">{s.name}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">{s.title}</p>
      <p className={`mt-0.5 text-[11px] ${line.tone} ${s.state === "thinking" ? "animate-pulse motion-reduce:animate-none" : ""}`}>{line.text}</p>
      {s.costUsd > 0 && <p className="num mt-0.5 text-[10px] text-ink-3">AI {ai(s.costUsd)}</p>}
    </li>
  );
}

export default function DeskTable({ messages, mandate, now }: { messages: SessionMessageDto[]; mandate: Mandate; now: number }) {
  const seats = deriveSeats(messages, { debate: mandate.debate, now });
  const speaker = seats.find((s) => s.speaking && s.lastBody);
  const cycle = seats[0]?.cycle ?? null;
  const spent = seats.reduce((t, s) => t + s.costUsd, 0);
  const modelOf = (s: Seat) => {
    const ref = s.model ? mandate.models[s.model] : null;
    return s.kind === "engine" ? "code, no model" : ref ? `${ref.provider} ${ref.model}` : "account default model";
  };

  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <li className="grid place-items-center rounded-[50%] border border-line-2 bg-wash px-4 py-6 text-center sm:col-start-2 sm:row-start-1 sm:row-span-2">
          <div>
            <p className="text-sm font-semibold text-ink">{cycle == null ? "no cycle yet" : `cycle ${cycle}`}</p>
            <p className="num mt-0.5 text-[11px] text-ink-3">AI {ai(spent)} so far</p>
            {!mandate.debate && <p className="mt-0.5 text-[11px] text-ink-3">debate off</p>}
          </div>
        </li>
        {seats.map((s) => <SeatCard key={s.role} s={s} model={modelOf(s)} />)}
      </ul>
      <div aria-live="polite" className="mt-4">
        {speaker ? (
          <div className="rounded-xl border border-line bg-paper p-3">
            <p className="text-xs">
              <span className="font-semibold text-ink">{speaker.name}</span>
              {speaker.lastAt && <time className="num ml-2 text-ink-3" dateTime={speaker.lastAt}>{hhmm(speaker.lastAt)}</time>}
            </p>
            <p className="mt-1 line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-ink-2">{speaker.lastBody}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-3">Nobody has spoken this cycle yet.</p>
        )}
      </div>
    </div>
  );
}
