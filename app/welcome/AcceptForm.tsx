"use client";

import { useActionState } from "react";
import { acceptDisclaimerAction } from "./actions";

export default function AcceptForm({ next }: { next: string }) {
  const [error, formAction, pending] = useActionState(acceptDisclaimerAction, undefined);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="understood" required className="mt-0.5 h-4 w-4 accent-ink" />
        <span>I have read and understood the risk disclaimer and agree to the terms of use. I understand AlphaBoard is not financial advice.</span>
      </label>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-ink py-2.5 text-sm font-semibold text-paper disabled:opacity-50">
        {pending ? "Saving…" : "Accept and continue"}
      </button>
    </form>
  );
}
