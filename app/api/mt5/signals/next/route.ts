import { deviceRoute } from "@/lib/http/userRoute";
import { claimJobs } from "@/lib/signalDesk/service";
import { encodeJobs } from "@/lib/signalDesk/wire";

export const dynamic = "force-dynamic";

/** SignalCopier.mq5 polls here: claims pending signals and queued commands, one job per line (empty = nothing). */
export const GET = deviceRoute(async (req, device) => {
  return new Response(encodeJobs(await claimJobs(device)), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
});
