import type { NextAuthConfig } from "next-auth";

/** Paths reachable without a session. Everything else requires login. */
export const PUBLIC_PATHS = ["/", "/login", "/register", "/legal", "/api/health"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;      // NextAuth + register
  if (pathname.startsWith("/legal/")) return true;
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
      if (isPublicPath(pathname)) return true;

      if (!loggedIn && pathname.startsWith("/api/")) {
        return Response.json({ error: "Authentication required", code: "UNAUTHORIZED" }, { status: 401 });
      }
      return loggedIn; // false → redirect to pages.signIn
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.sub ?? "";
        (session.user as { role?: string }).role = (token.role as string) ?? "USER";
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
