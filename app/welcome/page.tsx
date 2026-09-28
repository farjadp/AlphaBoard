import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import { safeNext } from "@/lib/legal/gate";
import { RiskPoints } from "@/components/legal/DisclaimerText";
import AcceptForm from "./AcceptForm";

export const metadata: Metadata = { title: "Before you start — AlphaBoard" };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { next } = await searchParams;

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="panel w-full max-w-xl space-y-5 p-6 md:p-8">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-ink">Before you start, please read this once</h1>
          <p className="mt-2 text-sm text-ink-2">AlphaBoard helps you analyse markets and practise with paper money. Here is what it is not:</p>
        </div>
        <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-line bg-wash p-4 text-sm leading-relaxed text-ink-2">
          <RiskPoints />
          <p className="mt-3">
            Full text, including the terms of use: <a href="/legal" target="_blank" rel="noopener" className="font-semibold text-accent underline">Risk disclaimer &amp; terms</a>.
          </p>
        </div>
        <AcceptForm next={safeNext(typeof next === "string" ? next : null)} />
      </div>
    </main>
  );
}
