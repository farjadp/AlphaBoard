import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/dal";
import Landing from "@/components/landing/Landing";
import HomeRedirect from "@/components/shell/HomeRedirect";

export const metadata: Metadata = {
  title: { absolute: "AlphaBoard — know when to trade, and when to stay flat" },
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AlphaBoard",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Trading-intelligence workspace: multi-timeframe market reads, AI trade plans from the model you choose, paper trading with fees and slippage, and every AI signal graded against what price did next.",
};

/** Signed out: the public landing. Signed in: straight to the markets. */
export default async function Home() {
  const user = await getSessionUser();
  if (user) return <HomeRedirect />;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Landing />
    </>
  );
}
