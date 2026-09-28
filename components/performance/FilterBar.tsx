"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const select = "rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--text)] outline-none focus-visible:border-[var(--accent)]";

/** Filters live in the URL, so a filtered view can be bookmarked and the server renders it directly. */
export default function FilterBar({ options }: { options: { symbols: string[]; timeframes: string[]; models: string[] } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  };
  const field = (key: string, label: string, values: Array<[string, string]>) => (
    <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--text-3)]">
      {label}
      <select className={select} value={params.get(key) ?? ""} onChange={(e) => set(key, e.target.value)}>
        {values.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Filters">
      {field("days", "Period", [["", "All time"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"]])}
      {field("symbol", "Asset", [["", "All"], ...options.symbols.map((s): [string, string] => [s, s])])}
      {field("timeframe", "Timeframe", [["", "All"], ...options.timeframes.map((s): [string, string] => [s, s])])}
      {field("model", "Model", [["", "All"], ...options.models.map((s): [string, string] => [s, s])])}
    </div>
  );
}
