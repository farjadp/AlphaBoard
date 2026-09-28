import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Optimistic auth check at the edge. Real enforcement lives in requireUser() inside
// every Route Handler / Server Action (see lib/auth/dal.ts).
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)",
  ],
};
