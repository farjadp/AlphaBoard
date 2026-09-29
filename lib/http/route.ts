import { NextResponse } from "next/server";
import { errorResponse } from "./errors";
import { requestLogger } from "./logger";
import { recordEvent } from "@/lib/ops/events";

type Handler<Ctx> = (req: Request, ctx: Ctx & { requestId: string }) => Promise<Response> | Response;

/**
 * Wraps a Route Handler: request id, structured access log, HttpError → JSON.
 * Authentication is NOT implicit here; call requireUser()/requireAdmin() inside.
 */
export function route<Ctx = Record<string, unknown>>(handler: Handler<Ctx>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const { requestId, log } = requestLogger(req);
    const started = Date.now();
    try {
      const res = await handler(req, { ...(ctx ?? ({} as Ctx)), requestId });
      const out = res instanceof NextResponse ? res : new NextResponse(res.body, res);
      out.headers.set("x-request-id", requestId);
      log.info({ status: out.status, ms: Date.now() - started }, "request");
      return out;
    } catch (err) {
      const res = errorResponse(err, requestId);
      res.headers.set("x-request-id", requestId);
      const level = res.status >= 500 ? "error" : "warn";
      log[level]({ status: res.status, ms: Date.now() - started, err: err instanceof Error ? err.message : String(err) }, "request failed");
      if (res.status >= 500) {
        await recordEvent({ source: "http", message: `${req.method} ${new URL(req.url).pathname}: ${err instanceof Error ? err.message : String(err)}`, requestId });
      }
      return res;
    }
  };
}
