/**
 * Content-Security-Policy with a per-request nonce (see proxy.ts).
 * Next.js reads the nonce from the request's CSP header and stamps it on its inline scripts.
 */
const CONNECT_SRC = [
  "'self'",
  "https://data-api.binance.vision",
  "wss://data-stream.binance.vision",
];

export function buildCsp(nonce: string, isDev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are still used across the UI (removed in P7); keep unsafe-inline for styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${CONNECT_SRC.join(" ")}${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
