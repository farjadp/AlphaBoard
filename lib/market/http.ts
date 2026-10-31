// data-api.binance.vision serves public market data without the geo-blocks that hit api.binance.com
// from US cloud regions; the others are fallbacks.
export const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
] as const;

/** GET a Binance public endpoint (`/api/v3/...`), trying each host in turn; `check` rejects a bad body. */
export async function binanceJson<T>(pathAndQuery: string, check?: (body: T) => string | null): Promise<T> {
  let lastError = "no host tried";
  for (const host of BINANCE_HOSTS) {
    try {
      const body = await fetchJson<T>(`${host}${pathAndQuery}`);
      const problem = check?.(body);
      if (problem) throw new Error(problem);
      return body;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`binance ${pathAndQuery.split("?")[0]} failed: ${lastError}`);
}

/** fetch → JSON with a hard timeout. Throws on non-2xx so callers can fall through to another provider. */
export async function fetchJson<T = unknown>(
  url: string,
  init: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(init.timeoutMs ?? 8_000),
    cache: "no-store", // caching is done by marketMemo
  });
  if (!res.ok) {
    const host = new URL(url).host;
    throw new Error(`${host} responded ${res.status}`);
  }
  return (await res.json()) as T;
}
