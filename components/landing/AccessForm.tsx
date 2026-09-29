"use client";

import { useState } from "react";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

const field =
  "w-full rounded-lg border border-line-2 bg-paper px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-3 outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft";

/** Waitlist signup. The server answers the same way for new and known emails. */
export default function AccessForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), name: f.get("name"), note: f.get("note"), website: f.get("website") }),
      });
      if (res.status === 429) throw new Error("Too many requests from this network. Please try again in an hour.");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.code === "VALIDATION" ? "Please check the email address." : "Something went wrong. Please try again.");
      }
      setState({ kind: "done" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong. Please try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="rounded-2xl border border-up/30 bg-up-soft p-6">
        <p className="font-display text-xl font-extrabold text-ink">You&apos;re on the list.</p>
        <p className="mt-2 text-[15px] text-ink-2">When a place opens up you&apos;ll get a personal invite link by email. Nothing else will be sent to that address.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="ar-email" className="mb-1.5 block text-sm font-semibold text-ink">Email</label>
        <input id="ar-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} />
      </div>
      <div>
        <label htmlFor="ar-name" className="mb-1.5 block text-sm font-semibold text-ink">
          Name <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <input id="ar-name" name="name" maxLength={80} autoComplete="name" className={field} />
      </div>
      <div>
        <label htmlFor="ar-note" className="mb-1.5 block text-sm font-semibold text-ink">
          What do you trade? <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <textarea id="ar-note" name="note" rows={3} maxLength={500} placeholder="e.g. BTC and gold swing trades on 4H" className={`${field} resize-y`} />
      </div>
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="ar-website">Website</label>
        <input id="ar-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {state.kind === "error" && <p role="alert" className="text-sm font-medium text-down">{state.message}</p>}
      <button
        type="submit" disabled={state.kind === "sending"}
        className="w-full rounded-lg bg-ink px-5 py-3 text-[15px] font-bold text-paper transition-colors hover:bg-ink-hover disabled:cursor-wait disabled:opacity-60"
      >
        {state.kind === "sending" ? "Sending…" : "Request an invite"}
      </button>
      <p className="text-xs leading-relaxed text-ink-3">We only use your email to send an invite. See the <a href="/legal" className="underline underline-offset-2 hover:text-ink-2">disclaimer &amp; terms</a>.</p>
    </form>
  );
}
