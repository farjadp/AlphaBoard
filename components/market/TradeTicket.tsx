"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/binance";
import { buildTradePlan } from "@/lib/market/tradePlan";
import { signedPct, timeAgo } from "@/lib/format";
import type { AnalysisResult } from "@/lib/types/analysis";
import type { ArchivedSignal } from "@/lib/types/userData";
import type { TrackRecord } from "@/lib/eval/trackRecord";
import TrackRecordStrip from "./TrackRecordStrip";

export type PlanSource =
  | { kind: "fresh"; result: AnalysisResult }
  | { kind: "archived"; signal: ArchivedSignal };

export type AlertState = { status: "none" } | { status: "set"; condition: "above" | "below"; price: number };

interface TradeTicketProps {
  timeframeLabel: string;
  source: PlanSource | null;
  price?: number;
  loading: boolean;
  error: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  alert: AlertState;
  onSetAlert: (price: number) => void;
  /** The user's graded history for this symbol + timeframe (P5). */
  record: TrackRecord;
  symbol: string;
  timeframe: string;
}

interface PlanView {
  signal: string;
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  tradeStyle?: string;
  risk?: AnalysisResult["risk_management"];
  breakdown?: AnalysisResult["indicators_breakdown"];
  supportResistance?: AnalysisResult["supportResistance"];
  safeEntries?: AnalysisResult["safeEntries"];
  generatedAt?: string;
  model?: string;
  priceAtSignal?: number;
  signalId?: string;
  archived: boolean;
  /** Set when an archived plan has already played out (P5 evaluation): it is history, not a live plan. */
  outcome?: { status: string; rMultiple: number | null; resolvedAt: string | null };
}

function toView(source: PlanSource): PlanView {
  if (source.kind === "fresh") {
    const r = source.result;
    return {
      signal: r.signal, confidence: r.confidence, entry: r.entry, stopLoss: r.stopLoss, takeProfit: r.takeProfit,
      reasoning: r.reasoning, tradeStyle: r.tradeStyle, risk: r.risk_management, breakdown: r.indicators_breakdown,
      supportResistance: r.supportResistance, safeEntries: r.safeEntries,
      generatedAt: r.context?.generatedAt, model: r.context?.ai?.model, priceAtSignal: r.context?.priceAtSignal, signalId: r.id, archived: false,
    };
  }
  const s = source.signal;
  return {
    signal: s.signal, confidence: s.confidence, entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit,
    reasoning: s.reasoning, tradeStyle: s.tradeStyle, risk: s.risk_management, breakdown: s.indicators_breakdown,
    generatedAt: s.timestamp, priceAtSignal: s.price, signalId: s.id, archived: true,
    outcome: s.evaluation && s.evaluation.status !== "OPEN" ? s.evaluation : undefined,
  };
}

/** The strategy as a trade ticket: decision first, then the numbers, then the actions. */
export default function TradeTicket(props: TradeTicketProps) {
  const { timeframeLabel, source, loading, error } = props;

  if (loading) {
    return (
      <section aria-label="Trade plan" aria-busy="true" className="panel flex flex-col gap-4 p-6">
        <span className="label-caps">Strategy · {timeframeLabel}</span>
        <p className="font-display text-2xl font-extrabold leading-tight text-ink">Building the plan…</p>
        <p className="text-[13.5px] leading-relaxed text-ink-2">Reading live price, all timeframes, futures, news and your past lessons.</p>
        <div className="skeleton h-24" />
        <div className="skeleton h-10" />
      </section>
    );
  }

  if (!source) {
    return (
      <section aria-label="Trade plan" className="panel flex flex-col gap-4 p-6">
        <span className="label-caps">Strategy · {timeframeLabel}</span>
        <p className="font-display text-[26px] font-extrabold leading-tight text-ink">No plan for {timeframeLabel} yet</p>
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          The AI reads live price, every timeframe, futures positioning, news and your journal lessons, then proposes an entry, target and stop. Each plan is saved to your archive.
        </p>
        {error && <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
        <button
          type="button"
          onClick={props.onGenerate}
          disabled={!props.canGenerate}
          className="h-11 rounded-lg bg-ink text-sm font-extrabold text-paper hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.canGenerate ? "Generate plan" : "Waiting for indicator data…"}
        </button>
        <TrackRecordStrip record={props.record} symbol={props.symbol} timeframe={props.timeframe} timeframeLabel={timeframeLabel} />
      </section>
    );
  }

  const v = toView(source);
  const plan = buildTradePlan(v);
  const tone = plan.direction === "long" ? "up" : plan.direction === "short" ? "down" : "none";
  const drift = v.priceAtSignal && props.price ? ((props.price - v.priceAtSignal) / v.priceAtSignal) * 100 : null;
  const done = v.outcome ? OUTCOME_TEXT[v.outcome.status] ?? "Resolved" : null;
  const live = plan.direction !== "none" && !done;

  return (
    <section aria-label="Trade plan" className="panel flex flex-col overflow-hidden">
      <div className="flex flex-col gap-3 px-6 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className={`rounded-md px-2.5 py-1 text-xs font-extrabold ${done ? "bg-wash text-ink-3" : tone === "up" ? "bg-up-soft text-up" : tone === "down" ? "bg-down-soft text-down" : "bg-wash text-ink-2"}`}>
            {done ? `${tone === "up" ? "LONG" : tone === "down" ? "SHORT" : "NO TRADE"} · PLAYED OUT` : tone === "up" ? "▲ LONG SETUP" : tone === "down" ? "▼ SHORT SETUP" : "■ NO TRADE"}
          </span>
          <span className="label-caps">{timeframeLabel} · AI confidence <span className="num">{v.confidence}%</span></span>
        </div>
        <p className="font-display text-[27px] font-extrabold leading-[1.12] tracking-tight text-ink text-balance">
          {plan.direction === "none"
            ? <>Stay flat. <span className="text-accent">No clean setup</span> on {timeframeLabel}.</>
            : <>{plan.direction === "long" ? "Buy" : "Sell"} near <span className="text-accent">{formatPrice(v.entry)}</span></>}
        </p>
        {plan.because && <p className="text-[13.5px] leading-relaxed text-ink-2">{plan.because}</p>}
        {done && v.outcome && (
          <p role="status" className={`rounded-lg px-3 py-2 text-[13px] font-semibold ${v.outcome.rMultiple != null && v.outcome.rMultiple > 0 ? "bg-up-soft text-up" : v.outcome.rMultiple != null && v.outcome.rMultiple < 0 ? "bg-down-soft text-down" : "bg-wash text-ink-2"}`}>
            This plan has already played out: {done}
            {v.outcome.rMultiple != null && <span className="num"> · {v.outcome.rMultiple > 0 ? "+" : v.outcome.rMultiple < 0 ? "−" : ""}{Math.abs(v.outcome.rMultiple).toFixed(2)}R</span>}
            {v.outcome.resolvedAt && <span className="font-normal"> · {timeAgo(v.outcome.resolvedAt)}</span>}. Generate a fresh plan before acting.
          </p>
        )}
      </div>

      {plan.direction !== "none" && (
        <>
          <div className="perforation" aria-hidden="true" />
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 px-6 pb-4 pt-1">
            <Figure label="Entry" value={formatPrice(v.entry)} />
            <Figure label="Risk : reward" value={plan.rr !== null ? `1 : ${plan.rr.toFixed(1)}` : "—"} />
            <Figure label="Take profit" value={formatPrice(v.takeProfit)} note={plan.rewardPct !== null ? signedPct(plan.direction === "long" ? plan.rewardPct : -plan.rewardPct, 1) : undefined} tone="up" />
            <Figure label="Stop" value={formatPrice(v.stopLoss)} note={plan.riskPct !== null ? signedPct(plan.direction === "long" ? -plan.riskPct : plan.riskPct, 1) : undefined} tone="down" />
            {plan.rr !== null && plan.riskPct !== null && plan.rewardPct !== null && (
              <div className="col-span-2">
                <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" role="img" aria-label={`Risk ${plan.riskPct.toFixed(1)} percent, reward ${plan.rewardPct.toFixed(1)} percent`}>
                  <rect x="0" y="0" width={(100 * plan.riskPct) / (plan.riskPct + plan.rewardPct)} height="8" className="fill-down" />
                  <rect x={(100 * plan.riskPct) / (plan.riskPct + plan.rewardPct)} y="0" width={(100 * plan.rewardPct) / (plan.riskPct + plan.rewardPct)} height="8" className="fill-up" />
                </svg>
              </div>
            )}
          </dl>
          {!plan.consistent && (
            <p role="alert" className="mx-6 mb-4 rounded-lg bg-amber-soft px-3 py-2 text-[13px] text-amber">
              The stop or target sits on the wrong side of the entry for a {plan.direction}. Treat this plan with caution and regenerate it.
            </p>
          )}
        </>
      )}

      <div className="flex flex-col gap-3 px-6 pb-5">
        {error && <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-[13px] text-down">{error}</p>}
        {live ? (
          <div className="grid grid-cols-2 gap-2">
            {v.signalId ? (
              <Link href={`/paper?signal=${encodeURIComponent(v.signalId)}`} className="flex h-10 items-center justify-center rounded-lg bg-ink text-[13px] font-extrabold text-paper hover:bg-ink-hover">
                Open paper trade
              </Link>
            ) : null}
            {props.alert.status === "set" ? (
              <Link href="/alerts" className={`flex h-10 items-center justify-center rounded-lg border border-line-2 text-[13px] font-bold text-ink hover:bg-wash ${v.signalId ? "" : "col-span-2"}`}>
                Alert set · {props.alert.condition} <span className="num ml-1">{formatPrice(props.alert.price)}</span>
              </Link>
            ) : (
              <button type="button" onClick={() => props.onSetAlert(v.entry)} className={`h-10 rounded-lg border border-line-2 text-[13px] font-bold text-ink hover:bg-wash ${v.signalId ? "" : "col-span-2"}`}>
                Alert me at entry
              </button>
            )}
          </div>
        ) : null}
        <button
          type="button"
          onClick={props.onGenerate}
          disabled={!props.canGenerate}
          className={!live
            ? "h-10 rounded-lg bg-ink text-[13px] font-extrabold text-paper hover:bg-ink-hover disabled:opacity-40"
            : "self-start text-[12.5px] font-bold text-accent hover:underline disabled:opacity-40"}
        >
          {v.archived ? "Generate a fresh plan" : "Regenerate plan"}
        </button>
        <p className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
          <span>{v.archived ? "From your archive" : "Generated"} {timeAgo(v.generatedAt)}{v.model ? ` · ${v.model}` : ""}</span>
          {drift !== null && (
            <span>Price since: <span className={`num ${drift >= 0 ? "text-up" : "text-down"}`}>{signedPct(drift)}</span></span>
          )}
        </p>
        <PlanDetails v={v} />
        <TrackRecordStrip record={props.record} symbol={props.symbol} timeframe={props.timeframe} timeframeLabel={timeframeLabel} />
      </div>
    </section>
  );
}

const OUTCOME_TEXT: Record<string, string> = {
  TP_HIT: "target hit", SL_HIT: "stopped out", EXPIRED: "expired without reaching either level", NO_FILL: "the entry was never reached", INVALID: "it could not be evaluated",
};

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" | "down" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps">{label}</dt>
      <dd className={`num text-[17px] font-semibold ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink"}`}>
        {value}{note && <span className="ml-1.5 text-[11px] font-medium text-ink-3">{note}</span>}
      </dd>
    </div>
  );
}

function PlanDetails({ v }: { v: PlanView }) {
  const hasAny = v.reasoning || v.risk || v.breakdown?.length || v.safeEntries?.length;
  if (!hasAny) return null;
  return (
    <details className="group rounded-lg border border-line">
      <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-bold text-ink-2 hover:text-ink">
        <span className="group-open:hidden">Show full reasoning and risk</span>
        <span className="hidden group-open:inline">Hide details</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line px-3 py-3 text-[13px] leading-relaxed text-ink-2">
        {v.reasoning && <p>{v.reasoning}</p>}
        {v.risk && (
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="label-caps">Leverage</dt><dd className="font-semibold text-ink">{v.risk.leverage}</dd><dd className="text-[12px]">{v.risk.leverageReasoning}</dd></div>
            <div><dt className="label-caps">Position size</dt><dd className="font-semibold text-ink">{v.risk.positionSize}</dd><dd className="text-[12px]">{v.risk.sizeReasoning}</dd></div>
          </dl>
        )}
        {v.safeEntries && v.safeEntries.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="label-caps">Alternative entries</span>
            {v.safeEntries.map((e, i) => (
              <p key={i}><span className="num font-semibold text-ink">{formatPrice(e.price)}</span> · {e.reasoning}</p>
            ))}
          </div>
        )}
        {v.breakdown && v.breakdown.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="label-caps">Indicators the AI weighed</span>
            {v.breakdown.map((b, i) => (
              <p key={i}>
                <span className={`font-bold ${b.signal === "Bullish" ? "text-up" : b.signal === "Bearish" ? "text-down" : "text-ink"}`}>{b.name}</span>
                <span className="num text-ink-3"> · {b.value}</span> · {b.explanation}
              </p>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
