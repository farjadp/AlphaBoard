import type { Metadata } from "next";
import Link from "next/link";
import { RiskPoints, TermsPoints } from "@/components/legal/DisclaimerText";

export const metadata: Metadata = { title: "Risk disclaimer & terms — AlphaBoard" };

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-sm leading-relaxed text-ink-2">
      <Link href="/" className="font-display text-[17px] font-extrabold text-ink">AlphaBoard</Link>
      <h1 className="mt-8 font-display text-3xl font-extrabold text-ink">Risk disclaimer &amp; terms of use</h1>
      <p className="mt-2 text-ink-3">Last updated 28 September 2026.</p>
      <section id="risk" className="mt-8 space-y-3">
        <h2 className="text-lg font-bold text-ink">Risk disclaimer</h2>
        <RiskPoints />
      </section>
      <section id="terms" className="mt-10 space-y-3">
        <h2 className="text-lg font-bold text-ink">Terms of use</h2>
        <TermsPoints />
      </section>
    </main>
  );
}
