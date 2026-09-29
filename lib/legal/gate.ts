/**
 * Risk-disclaimer gate (spec D18), pure so proxy.ts (edge) and tests share it.
 * Signed-in users who have not accepted are sent to /welcome; their API calls get 403.
 */
const EXEMPT_PREFIXES = ["/welcome", "/legal", "/login", "/register", "/api/auth/", "/api/health", "/api/cron/tick"];

export type GateDecision = "allow" | "redirect" | "forbid";

export function disclaimerGate(pathname: string, s: { loggedIn: boolean; accepted: boolean }): GateDecision {
  if (!s.loggedIn || s.accepted) return "allow";
  if (EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) return "allow";
  return pathname.startsWith("/api/") ? "forbid" : "redirect";
}

/** Post-acceptance destination: same-site absolute paths only. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/welcome")) return "/market";
  return next;
}
