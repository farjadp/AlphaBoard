import { deviceRoute } from "@/lib/http/userRoute";
import { recordReport } from "@/lib/signals/service";
import { parseReport } from "@/lib/signals/wire";

export const dynamic = "force-dynamic";


/** SignalCopier.mq5 → one event on a signal it claimed (form body, see lib/signals/wire.ts). Safe to repeat. */
export const POST = deviceRoute(async (req, device, { params }) => {
  const { id } = await params;
  await recordReport(device, id, parseReport(new URLSearchParams(await req.text())));
  return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });
});
