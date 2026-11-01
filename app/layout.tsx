import type { Metadata } from "next";
import { headers } from "next/headers";
import { JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";
import SiteFooter from "@/components/legal/SiteFooter";
import { siteUrl } from "@/lib/config/site";

// Public Sans: the workhorse face of public-service bulletins; one family carries UI and display.
const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-public",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
});

/** Runs before first paint so a pinned theme never flashes the other one. Mirrors components/shell/ThemeToggle. */
const THEME_BOOT = `try{var t=localStorage.getItem("alphaboard.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/*
 * Direction contract (impeccable, seed 22c77d72), emitted as the first child of <body>.
 */
const CONTRACT = `THESIS: every plan is a forecast bulletin, issued, stamped valid-until, then verified against what price did; refuses the dark neon terminal and the soft card dashboard.
OWN-WORLD: chart paper (day) / radar night (dark); faint isobar contours behind everything; square-cut sheets with a heavy top rule; isobar-blue accent; boxed mono issue stamps; Public Sans + JetBrains Mono for figures.
STORY: the trader reads the market, sees the issued plan and its verification record, and decides whether there is a trade today.
FIRST VIEWPORT: masthead nav with theme switch; watchlist band; chart sheet (AlphaBoard or TradingView, live candle) beside the bulletin ticket with its ISSUED / VALID stamps and primary Generate plan action.
FORM: Forecast Verification Bulletin, candidate 1 of 7 (the pick), seed 22c77d72.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance`;

// Nonce-based CSP (proxy.ts) requires request-time rendering: no prerendered HTML without the nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "AlphaBoard", template: "%s — AlphaBoard" },
  description:
    "Read live markets across six timeframes, draft a plan with the AI model you choose, rehearse it with paper money, and see every call graded against what price did next.",
  applicationName: "AlphaBoard",
  openGraph: { type: "website", siteName: "AlphaBoard", title: "AlphaBoard — know when to trade, and when to stay flat" },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // data-theme is set by THEME_BOOT before hydration, hence suppressHydrationWarning on <html> only.
    <html lang="en" className={`${publicSans.variable} ${jetbrainsMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="flex h-full flex-col bg-page font-sans text-ink">
        <div hidden dangerouslySetInnerHTML={{ __html: `<!-- ${CONTRACT} -->` }} />
        {/* Pages fill this scroll area (h-full / min-h-full), so the risk notice below stays visible. */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
