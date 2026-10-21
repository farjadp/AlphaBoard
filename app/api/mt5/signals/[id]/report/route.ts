import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { deviceFromRequest } from "@/lib/mt5/devices";
import { recordReport } from "@/lib/signals/service";
import { parseReport } from "@/lib/signals/wire";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** SignalCopier.mq5 → one event on a signal it claimed (form body, see lib/signals/wire.ts). Safe to repeat. */
export const POST = route<Ctx>(async (req, ctx) => {
  enforceRateLimit(req, "api");
  const device = await deviceFromRequest(req);
  const { id } = await ctx.params;
  await recordReport(device, id, parseReport(new URLSearchParams(await req.text())));
  return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });
});
