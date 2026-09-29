import Link from "next/link";

/** Persistent one-line risk notice on every page (spec D18). */
export default function SiteFooter() {
  return (
    <footer className="shrink-0 border-t border-line bg-paper px-4 py-1.5 text-center text-[11px] leading-snug text-ink-3 md:px-6">
      Analysis and paper trading only — not financial advice. AI output can be wrong; trading carries risk of loss.{" "}
      <Link href="/legal" className="font-semibold text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink">Risk disclaimer &amp; terms</Link>
    </footer>
  );
}
