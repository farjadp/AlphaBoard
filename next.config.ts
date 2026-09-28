import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Market-data hosts the browser talks to directly (WS tickers). Everything else goes through our API.
const connectSrc = [
  "'self'",
  "https://data-api.binance.vision",
  "wss://data-stream.binance.vision",
];

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Next.js needs inline styles for its runtime; scripts get 'unsafe-inline' only in dev for HMR.
  `script-src 'self' ${isProd ? "" : "'unsafe-eval' 'unsafe-inline'"}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  `connect-src ${connectSrc.join(" ")}${isProd ? "" : " ws://localhost:* http://localhost:*"}`,
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
