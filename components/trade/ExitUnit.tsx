"use client";

import { exitFromPercent, percentFromExit, type AnySide, type ExitKind } from "@/lib/trading/math";

/** Stops and targets can be typed as a price or as a percent distance from a reference price. */
export type ExitUnit = "price" | "pct";

const parse = (s: string) => {
  if (s.trim() === "") return null;
  const n = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** How a stored level is shown in a price field: 8 significant digits, no float noise. */
export const exitText = (n: number | null) => (n == null ? "" : String(Number(n.toPrecision(8))));

/**
 * The exit price a field means; null when empty, unparseable, or a percent with no reference price yet.
 * `current` is the level already set: a field still showing its rounded form keeps it exactly.
 */
export function exitPrice(text: string, unit: ExitUnit, side: AnySide, kind: ExitKind, ref: number | null, current?: number | null): number | null {
  const n = parse(text);
  if (n == null) return null;
  if (unit === "price") return current != null && text === exitText(current) ? current : n;
  if (ref == null) return null;
  if (current != null && text === convertExit(String(current), "price", "pct", side, kind, ref)) return current;
  return exitFromPercent(side, kind, ref, n);
}

/** Re-express a field's text in the other unit so switching keeps the same level. */
export function convertExit(text: string, from: ExitUnit, to: ExitUnit, side: AnySide, kind: ExitKind, ref: number | null): string {
  const n = parse(text);
  if (from === to || n == null || ref == null) return from === to ? text : "";
  return to === "pct"
    ? String(Number(percentFromExit(side, kind, ref, n).toFixed(2)))
    : String(Number(exitFromPercent(side, kind, ref, n).toPrecision(6)));
}

export function ExitUnitToggle({ unit, onChange, label = "Stop and target unit" }: { unit: ExitUnit; onChange: (u: ExitUnit) => void; label?: string }) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex rounded border border-line text-[11px] font-semibold">
      {(["price", "pct"] as const).map((u) => (
        <button
          key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => onChange(u)}
          className={`px-2 py-0.5 transition-colors first:rounded-l last:rounded-r ${unit === u ? "bg-ink text-paper" : "text-ink-3 hover:text-ink"}`}
        >
          {u === "price" ? "Price" : "%"}
        </button>
      ))}
    </span>
  );
}
