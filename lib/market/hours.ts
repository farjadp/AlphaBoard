/**
 * Weekly trading hours for everything that is not crypto (FX, metals, indices, energy at OANDA-style brokers):
 * open Sunday 17:00 New York, closed Friday 17:00 New York. New York time follows US daylight saving, so the
 * close is 21:00 UTC in summer and 22:00 UTC in winter. Pure, so the session clock can be unit-tested.
 */
import { findAsset } from "@/lib/assetCatalog";

const CLOSE_MIN = 17 * 60; // 17:00 New York
const DAY = 1440;
const FRIDAY = 5;
const SUNDAY = 0;

const nyFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function newYork(now: Date) {
  const parts = Object.fromEntries(nyFormat.formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: WEEKDAY[parts.weekday], minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** True for symbols that stop trading over the weekend (anything in the catalog that is not crypto). */
export function tradesWeekdaysOnly(symbol: string): boolean {
  const a = findAsset(symbol);
  return !!a && a.category !== "crypto";
}

export function weekendClosed(now: Date): boolean {
  const { weekday, minute } = newYork(now);
  return weekday === 6 || (weekday === FRIDAY && minute >= CLOSE_MIN) || (weekday === SUNDAY && minute < CLOSE_MIN);
}

/** Minutes until the Friday 17:00 New York close; 0 while the market is closed for the weekend. */
export function minutesToWeeklyClose(now: Date): number {
  if (weekendClosed(now)) return 0;
  const { weekday, minute } = newYork(now);
  return (FRIDAY - weekday) * DAY + (CLOSE_MIN - minute);
}
