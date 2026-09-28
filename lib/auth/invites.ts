import { createHash, randomBytes } from "node:crypto";

export type InviteState = "valid" | "used" | "expired" | "invalid";

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteState(
  invite: { expiresAt: Date; usedAt: Date | null } | null | undefined,
  now: Date = new Date(),
): InviteState {
  if (!invite) return "invalid";
  if (invite.usedAt) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

export const INVITE_TTL_DAYS = 14;

export function inviteExpiry(from: Date = new Date(), days = INVITE_TTL_DAYS): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function inviteUrl(token: string, base = process.env.APP_URL ?? "http://localhost:3000"): string {
  const u = new URL("/register", base);
  u.searchParams.set("token", token);
  return u.toString();
}
