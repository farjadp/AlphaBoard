import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { deviceFromRequest, recordHeartbeat } from "@/lib/mt5/devices";

export const dynamic = "force-dynamic";

/** SignalCopier.mq5 → account facts and Market Watch symbols (form body). Authenticated by the device token. */
export const POST = route(async (req) => {
  enforceRateLimit(req, "api");
  const device = await deviceFromRequest(req);
  await recordHeartbeat(device, new URLSearchParams(await req.text()));
  return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });
});
