import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { AccessRequestInput, dismissAccessRequest, inviteFromRequest, listAccessRequests, submitAccessRequest } from "@/lib/access/requests";
import { hashInviteToken } from "@/lib/auth/invites";

const run = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!run)("waitlist (Postgres)", () => {
  let admin: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User", "AccessRequest" CASCADE`);
    admin = (await prisma.user.create({ data: { email: "admin@test.local", passwordHash: "x", role: "ADMIN" } })).id;
    await prisma.user.create({ data: { email: "member@test.local", passwordHash: "x" } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("normalizes input, dedupes by email, and silently drops honeypot submissions", async () => {
    await submitAccessRequest(AccessRequestInput.parse({ email: "  Trader@Example.COM ", name: "", note: "I trade BTC swings" }), "9.9.9.9");
    await submitAccessRequest(AccessRequestInput.parse({ email: "trader@example.com", note: "updated note" }));
    await submitAccessRequest(AccessRequestInput.parse({ email: "bot@spam.test", website: "http://spam" }));
    const rows = await listAccessRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "trader@example.com", name: null, note: "updated note", status: "PENDING", ip: "9.9.9.9" });
    expect(() => AccessRequestInput.parse({ email: "not-an-email" })).toThrow();
  });

  it("turns a request into an email-bound invite once", async () => {
    const [r] = await listAccessRequests();
    const inv = await inviteFromRequest(admin, r.id);
    const token = new URL(inv.url).searchParams.get("token") ?? inv.url.split("token=")[1];
    const stored = await prisma.invite.findUniqueOrThrow({ where: { tokenHash: hashInviteToken(token!) } });
    expect(stored).toMatchObject({ email: "trader@example.com", role: "USER" });
    expect(await prisma.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "INVITED", inviteId: stored.id });
    await expect(inviteFromRequest(admin, r.id)).rejects.toMatchObject({ code: "HANDLED" });
  });

  it("refuses to invite an email that already has an account, and dismiss is idempotent", async () => {
    await submitAccessRequest(AccessRequestInput.parse({ email: "member@test.local" }));
    const r = (await listAccessRequests()).find((x) => x.email === "member@test.local")!;
    await expect(inviteFromRequest(admin, r.id)).rejects.toMatchObject({ code: "HAS_ACCOUNT" });
    await submitAccessRequest(AccessRequestInput.parse({ email: "later@example.com" }));
    const l = (await listAccessRequests()).find((x) => x.email === "later@example.com")!;
    await dismissAccessRequest(admin, l.id);
    await dismissAccessRequest(admin, l.id);
    expect(await prisma.auditLog.count({ where: { action: "admin.access_request_dismissed", target: l.id } })).toBe(1);
  });
});
