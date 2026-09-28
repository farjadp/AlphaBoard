import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { forbidden, unauthorized } from "@/lib/http/errors";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
};

/** Memoized per request render. Returns null when unauthenticated. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const u = session?.user as (Partial<SessionUser> & { email?: string | null }) | undefined;
  if (!u?.id || !u.email) return null;
  return { id: u.id, email: u.email, name: u.name ?? null, role: u.role === "ADMIN" ? "ADMIN" : "USER" };
});

/** Throws HttpError(401) — use inside Route Handlers and Server Actions. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}

/** Throws HttpError(401/403). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw forbidden();
  return user;
}
