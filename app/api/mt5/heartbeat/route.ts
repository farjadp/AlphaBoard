import { deviceRoute } from "@/lib/http/userRoute";
import { recordHeartbeat } from "@/lib/mt5/devices";

export const dynamic = "force-dynamic";

/** SignalCopier.mq5 → account facts and Market Watch symbols (form body). Authenticated by the device token. */
export const POST = deviceRoute(async (req, device) => {
  await recordHeartbeat(device, new URLSearchParams(await req.text()));
  return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });
});
