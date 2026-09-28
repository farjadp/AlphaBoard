import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";
import SiteFooter from "@/components/legal/SiteFooter";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-bricolage",
});

// Nonce-based CSP (proxy.ts) requires request-time rendering: no prerendered HTML without the nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AlphaBoard — Trading Dashboard",
  description: "Professional crypto & markets trading dashboard with real-time data, AI-powered analysis, and institutional-grade tools.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrainsMono.variable} ${bricolage.variable} h-full`}>
      <body className="flex h-full flex-col bg-page font-sans text-ink">
        {/* Pages fill this scroll area (h-full / min-h-full), so the risk notice below stays visible. */}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
