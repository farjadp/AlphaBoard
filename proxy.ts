import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { buildCsp, generateNonce } from "./lib/http/csp";

const { auth } = NextAuth(authConfig);

// 1) Optimistic auth check (authConfig.callbacks.authorized) — real enforcement is requireUser() in every
//    Route Handler / Server Action. 2) Per-request CSP nonce so Next's inline scripts run under a strict policy.
export default auth((req) => {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
});

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)",
  ],
};
