import "server-only";
import { PROVIDERS } from "./catalog";
import type { ProviderId } from "./providers/types";

/** Providers whose API key is present on this server. */
export function configuredProviders(): Set<ProviderId> {
  return new Set((Object.keys(PROVIDERS) as ProviderId[]).filter((p) => !!process.env[PROVIDERS[p].envKey]));
}
