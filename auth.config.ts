import type { NextAuthConfig } from "next-auth";
import { disclaimerGate } from "./lib/legal/gate";

/** Paths reachable without a session. Everything else requires login. */
export const PUBLIC_PATHS = ["/", "/login", "/register", "/legal", "/api/health"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;      // NextAuth + register
  if (pathname.startsWith("/legal/")) return true;
  if (pathname === "/api/cron/tick") return true;       // authenticates itself (CRON_SECRET or admin)
  return false;
}

export const authConfig = {
  pages: { signIn: "/login" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      if (loggedIn && (pathname === "/login" || pathname === "/register")) {
        return Response.redirect(new URL("/market", nextUrl));
      }
      // Risk disclaimer (D18): the claim is set from the DB at login and after acceptance (auth.ts).
      const gate = disclaimerGate(pathname, { loggedIn, accepted: (auth?.user as { disclaimer?: boolean } | undefined)?.disclaimer === true });
      if (gate === "forbid") {
        return Response.json({ error: "Please accept the risk disclaimer first", code: "DISCLAIMER_REQUIRED" }, { status: 403 });
      }
      if (gate === "redirect") {
        const to = new URL("/welcome", nextUrl);
        to.searchParams.set("next", `${pathname}${nextUrl.search}`);
        return Response.redirect(to);
      }

      if (isPublicPath(pathname)) return true;

      if (!loggedIn && pathname.startsWith("/api/")) {
        return Response.json({ error: "Authentication required", code: "UNAUTHORIZED" }, { status: 401 });
      }
      return loggedIn; // false → redirect to pages.signIn
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? "USER";
        token.disclaimer = (user as { disclaimer?: boolean }).disclaimer === true;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.sub ?? "";
        (session.user as { role?: string }).role = (token.role as string) ?? "USER";
        (session.user as { disclaimer?: boolean }).disclaimer = token.disclaimer === true;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
