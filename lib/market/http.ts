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
