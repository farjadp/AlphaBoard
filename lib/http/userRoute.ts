import { route } from "./route";
import { requireAdmin, requireUser, type SessionUser } from "@/lib/auth/dal";
import { deviceFromRequest } from "@/lib/signalDesk/devices";
import type { Mt5Device } from "@prisma/client";
import { enforceRateLimit } from "./rateLimit";

type IdCtx = { params: Promise<{ id: string }> };

/** Authenticated, rate-limited route for the signed-in user's own data. */
export function userRoute(handler: (req: Request, user: SessionUser) => Promise<Response>) {
  return route(async (req) => {
    const user = await requireUser();
    await enforceRateLimit(req, "api");
    return handler(req, user);
  });
}

/** Same, for /[id] routes. */
export function userIdRoute(handler: (req: Request, user: SessionUser, id: string) => Promise<Response>) {
  return route<IdCtx>(async (req, ctx) => {
    const user = await requireUser();
    await enforceRateLimit(req, "api");
    const { id } = await ctx.params;
    return handler(req, user, id);
  });
}

/** Dynamic segments for /[id] routes (Next always passes `params`; tests pass `Promise.resolve({})`). */
type ParamsCtx = { params: Promise<Record<string, string>> };

/** Admin-only, rate-limited route. `ctx.params` carries dynamic segments for /[id] routes. */
export function adminRoute(handler: (req: Request, admin: SessionUser, ctx: ParamsCtx & { requestId: string }) => Promise<Response>) {
  return route<ParamsCtx>(async (req, ctx) => {
    const admin = await requireAdmin();
    await enforceRateLimit(req, "api");
    return handler(req, admin, ctx);
  });
}

/** Route for an MT5 terminal: rate-limited, authenticated by its device token (no session). */
export function deviceRoute(handler: (req: Request, device: Mt5Device, ctx: ParamsCtx & { requestId: string }) => Promise<Response>) {
  return route<ParamsCtx>(async (req, ctx) => {
    await enforceRateLimit(req, "api");
    const device = await deviceFromRequest(req);
    return handler(req, device, ctx);
  });
}
