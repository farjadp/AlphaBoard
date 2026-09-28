"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { collectLegacyImages, parseLegacyData } from "@/lib/import/legacy";
import { clearLegacyStorage, readLegacyStorage, useHydrated } from "@/lib/client/legacy";
import { compressImage } from "@/lib/client/image";
import { apiErrorMessage } from "@/lib/client/apiError";
import { resetAllResources } from "@/lib/client/resource";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "importing" }
  | { kind: "done"; imported: Record<string, number>; skipped: Record<string, number>; imageFailures: number }
  | { kind: "error"; message: string };

const LABELS: Record<string, string> = {
  watchlist: "Watchlist symbols", journal: "Journal entries", lessons: "Post-mortem lessons",
  signals: "Archived AI signals", chartLessons: "Chart academy studies", alerts: "Price alerts",
};

function dataUrlToFile(dataUrl: string): File {
  // Decoded in memory: fetch("data:…") is blocked by our CSP (connect-src), on purpose.
  const [meta, b64] = dataUrl.split(",", 2);
  const mime = /^data:([^;]+);base64$/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], "image", { type: mime });
}

export default function ImportPage() {
  const hydrated = useHydrated();
  const [version, setVersion] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const preview = useMemo(() => {
    if (!hydrated) return null;
    void version;
    const raw = readLegacyStorage();
    return { raw, parsed: parseLegacyData(raw), images: collectLegacyImages(readLegacyStorage()).length };
  }, [hydrated, version]);

  async function runImport() {
    const raw = readLegacyStorage(); // fresh copy; mutated in place as images are uploaded
    const images = collectLegacyImages(raw);
    let imageFailures = 0;
    try {
      for (let i = 0; i < images.length; i++) {
        setPhase({ kind: "uploading", done: i, total: images.length });
        try {
          const compressed = await compressImage(dataUrlToFile(images[i].dataUrl));
          const res = await fetch("/api/attachments", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: compressed }),
          });
          if (!res.ok) throw new Error(await apiErrorMessage(res));
          images[i].setAttachmentId((await res.json()).id);
        } catch {
          imageFailures++; // the row still imports, without that image
          images[i].setAttachmentId("");
        }
      }
      setPhase({ kind: "importing" });
      const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(raw) });
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Import failed"));
      const body = await res.json();
      resetAllResources(); // every page reloads from the server
      setPhase({ kind: "done", imported: body.imported, skipped: body.skipped, imageFailures });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Import failed" });
    }
  }

  function removeBrowserCopy() {
    if (!window.confirm("Remove the old copy of your data from this browser? Your account data is not affected.")) return;
    clearLegacyStorage();
    setVersion((v) => v + 1);
  }

  const busy = phase.kind === "uploading" || phase.kind === "importing";
  const counts = preview?.parsed;
  const nothing = !!counts && counts.total === 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
      <NavBar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-gray-100">Import browser data</h1>
            <p className="text-sm text-gray-400 mt-1">
              Earlier versions of AlphaBoard saved your journal, lessons, signals and alerts only in this browser.
              Import them into your account so they are safe and available on every device.
            </p>
          </header>

          {!preview ? (
            <p className="text-sm text-gray-400">Reading this browser&apos;s storage…</p>
          ) : nothing && phase.kind !== "done" ? (
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm text-gray-300">
              No AlphaBoard data was found in this browser. If you used AlphaBoard on another device or browser, open this page there.
            </section>
          ) : (
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-200">Found in this browser</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {Object.entries(LABELS).map(([key, label]) => {
                  const n = key === "watchlist" ? counts!.watchlist.length : (counts![key as keyof typeof counts] as unknown[]).length;
                  const skipped = (counts!.skipped as Record<string, number>)[key] ?? 0;
                  return (
                    <div key={key} className="rounded-lg border border-white/10 p-3">
                      <dt className="text-xs text-gray-400">{label}</dt>
                      <dd className="text-lg font-semibold tabular-nums text-gray-100">{n}{skipped > 0 && <span className="ml-2 text-xs font-normal text-amber-400">{skipped} unreadable</span>}</dd>
                    </div>
                  );
                })}
              </dl>
              <p className="text-xs text-gray-400">{preview.images} image{preview.images === 1 ? "" : "s"} will be compressed and uploaded. Importing twice is safe: rows already imported are skipped.</p>

              {phase.kind !== "done" && (
                <button type="button" onClick={runImport} disabled={busy}
                  className="w-full rounded-lg bg-gray-100 py-2.5 text-sm font-semibold text-gray-900 hover:bg-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                  {phase.kind === "uploading" ? `Uploading images ${phase.done + 1}/${phase.total}…` : phase.kind === "importing" ? "Importing…" : "Import to my account"}
                </button>
              )}
            </section>
          )}

          {phase.kind === "error" && (
            <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{phase.message}</div>
          )}

          {phase.kind === "done" && (
            <section role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3">
              <h2 className="text-sm font-semibold text-emerald-300">Import complete</h2>
              <ul className="text-sm text-emerald-100 space-y-1">
                {Object.entries(phase.imported).map(([k, n]) => <li key={k}>{LABELS[k] ?? k}: <span className="tabular-nums font-semibold">{n}</span> added</li>)}
              </ul>
              {phase.imageFailures > 0 && <p className="text-xs text-amber-300">{phase.imageFailures} image(s) could not be uploaded. The entries and lessons were still imported, without those images.</p>}
              <div className="flex flex-wrap gap-3 pt-2">
                <Link href="/journal" className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-white">Open journal</Link>
                {!nothing && (
                  <button type="button" onClick={removeBrowserCopy} className="rounded-lg border border-white/20 px-4 py-2 text-sm text-gray-200 hover:bg-white/5">
                    Remove the browser copy
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
