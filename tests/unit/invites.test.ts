import { describe, it, expect } from "vitest";
import { generateInviteToken, hashInviteToken, inviteState } from "@/lib/auth/invites";

describe("invite tokens", () => {
  it("generates url-safe tokens of sufficient entropy", () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(generateInviteToken()).not.toBe(t);
  });

  it("hashes deterministically and never stores the raw token", () => {
    const t = generateInviteToken();
    expect(hashInviteToken(t)).toBe(hashInviteToken(t));
    expect(hashInviteToken(t)).not.toContain(t);
    expect(hashInviteToken(t)).toHaveLength(64); // sha256 hex
  });
});

describe("inviteState", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const base = { expiresAt: new Date("2026-10-27T12:00:00Z"), usedAt: null as Date | null };

  it("is valid when unused and unexpired", () => {
    expect(inviteState(base, now)).toBe("valid");
  });
  it("is used once consumed", () => {
    expect(inviteState({ ...base, usedAt: new Date("2026-09-20T00:00:00Z") }, now)).toBe("used");
  });
  it("is expired past expiresAt", () => {
    expect(inviteState({ ...base, expiresAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe("expired");
  });
  it("missing invite is invalid", () => {
    expect(inviteState(null, now)).toBe("invalid");
  });
});
