import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { deviceFromRequest } from "@/lib/mt5/devices";
import { claimJobs } from "@/lib/signals/service";
import { encodeJobs } from "@/lib/signals/wire";

export const dynamic = "force-dynamic";

/** SignalCopier.mq5 polls here: claims pending signals and queued commands, one job per line (empty = nothing). */
export const GET = route(async (req) => {
  enforceRateLimit(req, "api");
  const device = await deviceFromRequest(req);
  return new Response(encodeJobs(await claimJobs(device)), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
});
