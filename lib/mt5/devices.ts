import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Mt5Device } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, unauthorized } from "@/lib/http/errors";

/**
 * MT5 terminals running SignalCopier.mq5 (P12). Each gets a bearer token that is shown once and stored only as a
 * SHA-256 hash; `last4` is kept for display. A revoked token stops working at once.
 */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const MODES = new Set(["DEMO", "REAL", "CONTEST"]);
const SYMBOL = /^[A-Za-z0-9._#+-]{1,32}$/;
const MAX_SYMBOLS = 2_000;

export async function createDevice(userId: string, label: string): Promise<{ device: Mt5Device; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const device = await prisma.mt5Device.create({ data: { userId, label: label.trim().slice(0, 60) || "MT5 terminal", tokenHash: hashToken(token), last4: token.slice(-4) } });
  return { device, token };
}

/** The device behind `Authorization: Bearer <token>`; 401 when missing, unknown or revoked. Counts as "seen". */
export async function deviceFromRequest(req: Request, now = new Date()): Promise<Mt5Device> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw unauthorized("device token required");
  const device = await prisma.mt5Device.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!device || device.revokedAt) throw unauthorized("unknown or revoked device token");
  return prisma.mt5Device.update({ where: { id: device.id }, data: { lastSeenAt: now } });
}

export async function revokeDevice(userId: string, id: string, now = new Date()): Promise<void> {
  const r = await prisma.mt5Device.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: now } });
  if (r.count === 0) throw notFound("device not found");
}

/** login, server, mode, balance, currency and the Market Watch symbols, as the EA reports them. */
export async function recordHeartbeat(device: Mt5Device, form: URLSearchParams): Promise<void> {
  const mode = form.get("mode")?.trim() ?? "";
  if (!MODES.has(mode)) throw badRequest("mode must be DEMO, REAL or CONTEST");
  const balance = Number(form.get("balance"));
  if (!Number.isFinite(balance)) throw badRequest("balance must be a number");
  const text = (k: string) => form.get(k)?.trim().slice(0, 64) || null;
  const symbols = [...new Set((form.get("symbols") ?? "").split(",").map((s) => s.trim()).filter((s) => SYMBOL.test(s)))].slice(0, MAX_SYMBOLS);
  await prisma.mt5Device.update({
    where: { id: device.id },
    data: { login: text("login"), server: text("server"), tradeMode: mode, balance, currency: text("currency"), symbols },
  });
}
