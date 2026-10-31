import "server-only";
import type { Mt5Device } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { HttpError, badRequest, notFound } from "@/lib/http/errors";
import { notify } from "@/lib/notify/notifications";
import { telegramFromEnv, type Telegram } from "@/lib/notify/telegram";
import { findAsset } from "@/lib/assetCatalog";
import { getQuote } from "@/lib/market/quote";
import { roundForPrice } from "@/lib/market/indicators";
import { catalogSymbolFor } from "./levels";
import { channelUsername, getPostTemplate } from "./template";
import { channelFromEnv, type Channel } from "./channel";
import { displaySymbol, formatSignalPost } from "./format";
import { applyReport, type SignalView } from "./state";
import { checkSignal, signalInput } from "./validate";
import type { Job, ReportEvent } from "./wire";

/**
 * Signal Desk service (P12). Execution is at most once: a PENDING signal goes to SENT in one conditional update and
 * is never handed out again. Reports are applied under a row lock, so a retried report is a no-op (see state.ts).
 */
const CLAIM_BATCH = 10;
const EXPIRE_MS = 10 * 60_000;
const ONLINE_MS = 60_000;
/** A claimed signal with no FILLED / REJECTED / DRY_RUN after this is UNKNOWN; it is never re-sent. */
const SILENT_MS = 120_000;

const conflict = (msg: string) => new HttpError(409, msg, "CONFLICT");

/** Live price for a symbol as written; `futures` when the only feed is a futures contract (offset from spot). */
type MarketPriceOf = (symbol: string) => Promise<{ price: number; futures: boolean } | null>;

interface Deps { channel?: Channel | null; now?: Date; priceOf?: MarketPriceOf }

const livePriceOf: MarketPriceOf = async (symbol) => {
  const catalog = catalogSymbolFor(symbol);
  const asset = catalog ? findAsset(catalog) : undefined;
  const quote = asset ? await getQuote(asset).catch(() => null) : null;
  return asset && quote?.price ? { price: quote.price, futures: !!asset.yahooSymbol?.endsWith("=F") } : null;
};

/** PENDING signals of the device's owner → SENT for this device, plus queued commands for signals it holds. */
export async function claimJobs(device: Mt5Device, now = new Date()): Promise<Job[]> {
  const jobs: Job[] = [];

  const commands = await prisma.tradeSignal.findMany({
    where: { deviceId: device.id, userId: device.userId, pendingCommand: { not: null } },
    select: { id: true, pendingCommand: true },
  });
  for (const c of commands) {
    const r = await prisma.tradeSignal.updateMany({ where: { id: c.id, pendingCommand: c.pendingCommand }, data: { pendingCommand: null } });
    if (r.count === 1) jobs.push({ kind: "CMD", id: c.id, command: c.pendingCommand as "CLOSE_ALL" | "BREAKEVEN" });
  }

  const pending = await prisma.tradeSignal.findMany({
    where: { userId: device.userId, status: "PENDING", execute: true, expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    take: CLAIM_BATCH,
  });
  for (const s of pending) {
    const r = await prisma.tradeSignal.updateMany({ where: { id: s.id, status: "PENDING" }, data: { status: "SENT", sentAt: now, deviceId: device.id } });
    if (r.count !== 1) continue;
    jobs.push({ kind: "OPEN", id: s.id, symbol: s.symbol, side: s.side as "BUY" | "SELL", entry: s.entry, stop: s.stop, maxDeviation: s.maxDeviation, riskPct: s.riskPct, tps: s.tps });
  }
  return jobs;
}

/** One EA report on a signal this device claimed; 404 for any other device. Posts the channel reply after commit. */
export async function recordReport(device: Mt5Device, signalId: string, e: ReportEvent, deps: Deps = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TradeSignal" WHERE "id" = ${signalId} FOR UPDATE`;
    const s = await tx.tradeSignal.findFirst({ where: { id: signalId, userId: device.userId, deviceId: device.id }, include: { legs: true } });
    if (!s) throw notFound("signal not found");
    const view: SignalView = {
      status: s.status,
      side: s.side as "BUY" | "SELL",
      stop: s.stop,
      breakevenDone: s.breakevenAt != null,
      legs: s.legs.map((l) => ({ leg: l.leg, status: l.status, openPrice: l.openPrice, volume: l.volume, r: l.r })),
    };
    const t = applyReport(view, e);
    if (t.legCreate) await tx.tradeSignalLeg.create({ data: { signalId, ...t.legCreate } });
    if (t.legUpdate) {
      const { leg, ...data } = t.legUpdate;
      await tx.tradeSignalLeg.update({ where: { signalId_leg: { signalId, leg } }, data: { ...data, closedAt: now } });
    }
    await tx.tradeSignal.update({
      where: { id: signalId },
      data: {
        status: t.status as typeof s.status,
        ...(t.reason ? { statusReason: t.reason } : {}),
        ...(t.breakeven ? { breakevenAt: now } : {}),
      },
    });
    return { reply: t.reply, post: s.post, messageId: s.channelMessageId };
  });

  if (!outcome.reply || !outcome.post || outcome.messageId == null) return;
  const channel = deps.channel === undefined ? channelFromEnv() : deps.channel;
  if (!channel) return;
  try {
    await channel.reply(outcome.messageId, outcome.reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, signalId }, "signal channel reply failed");
    await prisma.tradeSignal.update({ where: { id: signalId }, data: { channelError: msg.slice(0, 300) } });
  }
}

export type SignalCommand = "CANCEL" | "CLOSE_ALL" | "BREAKEVEN";

/**
 * A new signal from the desk form: validated against the owner's most recently seen terminal, stored, then posted.
 * Execution never waits on Telegram; a failed post is kept in channelError. Returns warnings the form shows.
 */
export async function createSignal(userId: string, raw: unknown, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const parsed = signalInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "signal"}: ${i.message}`).join("; "));
  const input = parsed.data;
  // A post-only market signal still needs a number for the post and for R: the live price when it is sent.
  // Never a futures price: it is offset from broker spot and would print a wrong entry.
  if (!input.execute && input.entry == null) {
    const quote = await (deps.priceOf ?? livePriceOf)(input.symbol);
    if (!quote) throw badRequest(`No live price for ${input.symbol}: type the entry`);
    if (quote.futures) throw badRequest(`${input.symbol} data is futures and differs from broker spot: type your broker's price as the entry`);
    input.entry = roundForPrice(quote.price, quote.price);
  }
  const device = await prisma.mt5Device.findFirst({ where: { userId, revokedAt: null }, orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } } });
  const errs = checkSignal(input, { symbols: device?.symbols ?? [] });
  if (errs.length) throw badRequest(errs.join("; "));

  const expiresAt = new Date(now.getTime() + EXPIRE_MS);
  const warnings: string[] = [];
  if (input.execute && (!device?.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > ONLINE_MS)) {
    warnings.push(`terminal offline; the signal expires at ${expiresAt.toISOString().slice(11, 16)} UTC unless it comes back`);
  }
  let signal = await prisma.tradeSignal.create({
    data: { userId, ...input, expiresAt, ...(input.execute ? {} : { status: "CLOSED", statusReason: "channel only" }) },
  });
  if (!input.post) return { signal, warnings };

  const channel = deps.channel === undefined ? channelFromEnv() : deps.channel;
  let update: { channelMessageId?: number; channelError?: string };
  if (!channel) {
    update = { channelError: "channel not configured (SIGNAL_BOT_TOKEN / SIGNAL_CHANNEL_ID)" };
  } else {
    try {
      const { template } = await getPostTemplate();
      update = { channelMessageId: await channel.post(formatSignalPost(input, template, channelUsername())) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, signalId: signal.id }, "signal channel post failed");
      update = { channelError: msg.slice(0, 300) };
    }
  }
  signal = await prisma.tradeSignal.update({ where: { id: signal.id }, data: update });
  return { signal, warnings };
}

/** CANCEL a signal no terminal has taken yet, or queue CLOSE_ALL / BREAKEVEN for the terminal holding an open one. */
export async function queueCommand(userId: string, id: string, command: SignalCommand): Promise<void> {
  const r = command === "CANCEL"
    ? await prisma.tradeSignal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "CANCELLED", statusReason: "cancelled from the desk" } })
    : await prisma.tradeSignal.updateMany({ where: { id, userId, status: "OPEN" }, data: { pendingCommand: command } });
  if (r.count === 1) return;
  const s = await prisma.tradeSignal.findFirst({ where: { id, userId }, select: { status: true } });
  if (!s) throw notFound("signal not found");
  if (command === "CANCEL" && (s.status === "SENT" || s.status === "OPEN")) throw conflict("already sent to the terminal; use Close all");
  throw conflict(command === "CANCEL" ? `the signal is already ${s.status.toLowerCase()}` : "only an open signal takes this command");
}

/** Scheduler step: PENDING past expiry → EXPIRED; SENT without a word for 2 min → UNKNOWN plus one alert to the owner. */
export async function sweepSignals(now = new Date(), deps: { telegram?: Telegram | null } = {}) {
  const expired = await prisma.tradeSignal.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", statusReason: "no terminal took it in time" },
  });
  const silent = await prisma.tradeSignal.findMany({ where: { status: "SENT", sentAt: { lt: new Date(now.getTime() - SILENT_MS) } } });
  let unknown = 0;
  for (const s of silent) {
    const r = await prisma.tradeSignal.updateMany({
      where: { id: s.id, status: "SENT" },
      data: { status: "UNKNOWN", statusReason: "no report from the terminal within 2 min; check MT5" },
    });
    if (r.count !== 1) continue;
    unknown++;
    const telegram = deps.telegram === undefined ? telegramFromEnv() : deps.telegram;
    await notify(s.userId, {
      type: "signal",
      title: `${s.side} ${displaySymbol(s.symbol)}: no word from MT5`,
      body: "The terminal took this signal 2 minutes ago and has not reported a fill or a rejection. Check MT5: the trade may or may not be open. AlphaBoard will not send it again.",
      data: { signalId: s.id },
    }, telegram).catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e), signalId: s.id }, "signal alert failed"));
  }
  return { expired: expired.count, unknown };
}
