import { createResource } from "@/lib/client/resource";

export interface DeviceDto {
  id: string;
  label: string;
  last4: string;
  login: string | null;
  server: string | null;
  tradeMode: string | null;
  balance: number | null;
  currency: string | null;
  symbols: string[];
  lastSeenAt: string | null;
  createdAt: string;
}

export interface LegDto { leg: number; ticket: string; volume: number; openPrice: number; tp: number | null; status: "OPEN" | "TP" | "SL" | "CLOSED"; closePrice: number | null; r: number | null }

export interface SignalDto {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry: number | null;
  stop: number;
  tps: number[];
  riskPct: number;
  note: string | null;
  source: string | null;
  execute: boolean;
  post: boolean;
  status: "PENDING" | "SENT" | "OPEN" | "CLOSED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "UNKNOWN";
  statusReason: string | null;
  pendingCommand: string | null;
  channelMessageId: number | null;
  channelError: string | null;
  expiresAt: string;
  createdAt: string;
  legs: LegDto[];
}

export const devicesRes = createResource<DeviceDto[]>("/api/signal-desk/devices", { fallback: [], select: (j) => (j as { devices: DeviceDto[] }).devices });
export const signalsRes = createResource<SignalDto[]>("/api/signal-desk", { fallback: [], select: (j) => (j as { signals: SignalDto[] }).signals });

/** A terminal counts as online when it polled within this window (it polls every few seconds). */
export const ONLINE_MS = 60_000;

export const isOnline = (d: Pick<DeviceDto, "lastSeenAt">, now = Date.now()) => d.lastSeenAt != null && now - Date.parse(d.lastSeenAt) <= ONLINE_MS;

export const btn = "rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink-hover disabled:opacity-50";
export const btnQuiet = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-wash hover:text-ink disabled:opacity-50";
export const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";
export const label = "mb-1 block text-xs font-semibold text-ink-2";
export const hint = "mt-1 text-xs text-ink-3";
