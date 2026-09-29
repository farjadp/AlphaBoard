import { route } from "./route";
import { requireUser, type SessionUser } from "@/lib/auth/dal";
import { enforceRateLimit } from "./rateLimit";

type IdCtx = { params: Promise<{ id: string }> };

/** Authenticated, rate-limited route for the signed-in user's own data. */
export function userRoute(handler: (req: Request, user: SessionUser) => Promise<Response>) {
  return route(async (req) => {
    const user = await requireUser();
    enforceRateLimit(req, "api");
    return handler(req, user);
  });
}

/** Same, for /[id] routes. */
export function userIdRoute(handler: (req: Request, user: SessionUser, id: string) => Promise<Response>) {
  return route<IdCtx>(async (req, ctx) => {
    const user = await requireUser();
    enforceRateLimit(req, "api");
    const { id } = await ctx.params;
    return handler(req, user, id);
  });
}
