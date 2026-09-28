import "server-only";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import type { PriceOf } from "@/lib/paper/account";
import type { Bar } from "@/lib/paper/engine";
import { alertHit } from "./evaluate";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 6 });

/**
 * Server-side price alerts (replaces the old "only while /alerts is open" check): each active alert
 * fires once, on the first 5m candle high/low (or live quote) that crosses its level.
 */
export async function evaluateAlerts(opts: {
  now: Date;
  barsOf: (symbol: string) => Promise<Bar[] | null>;
  priceOf: PriceOf;
  telegram: Telegram | null;
}) {
  const active = await prisma.priceAlert.findMany({ where: { triggered: false }, take: 5_000 });
  const errors: string[] = [];
  const symbols = [...new Set(active.map((a) => a.symbol))];
  const market = new Map(await Promise.all(symbols.map(async (s) => {
    const [bars, price] = await Promise.all([
      opts.barsOf(s).catch((e) => { errors.push(`${s} candles: ${e instanceof Error ? e.message : e}`); return null; }),
      opts.priceOf(s).catch(() => null),
    ]);
    return [s, { bars: bars ?? [], price }] as const;
  })));

  let fired = 0;
  for (const a of active) {
    const m = market.get(a.symbol)!;
    const t = opts.now.getTime();
    const bars = m.price != null ? [...m.bars, { time: t, open: m.price, high: m.price, low: m.price, close: m.price }] : m.bars;
    if (bars.length === 0) continue;
    try {
      const hit = alertHit(a, bars, a.lastCheckedAt.getTime());
      if (hit) {
        const done = await prisma.priceAlert.updateMany({
          where: { id: a.id, triggered: false },
          data: { triggered: true, triggeredAt: opts.now, triggerPrice: hit.price },
        });
        if (done.count === 1) {
          fired++;
          await notify(a.userId, {
            type: "price_alert",
            title: `${a.symbol} crossed ${a.condition} ${fmt(a.targetPrice)}`,
            body: `Price reached ${fmt(hit.price)} (${new Date(hit.at).toISOString().slice(11, 16)} UTC).`,
            data: { alertId: a.id, symbol: a.symbol, price: hit.price, href: "/alerts" },
          }, opts.telegram);
        }
        continue;
      }
      const latestStart = Math.max(...m.bars.map((b) => b.time), 0);
      if (latestStart > a.lastCheckedAt.getTime()) {
        await prisma.priceAlert.updateMany({ where: { id: a.id, triggered: false }, data: { lastCheckedAt: new Date(latestStart) } });
      }
    } catch (e) {
      errors.push(`alert ${a.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { active: active.length, fired, errors };
}
