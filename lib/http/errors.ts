import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Typed HTTP error the route wrapper turns into a JSON response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (msg = "Authentication required") => new HttpError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "Insufficient permissions") => new HttpError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "NOT_FOUND");
export const badRequest = (msg = "Invalid request", code = "BAD_REQUEST") => new HttpError(400, msg, code);
export const tooManyRequests = (retryAfterMs: number) =>
  Object.assign(new HttpError(429, "Too many requests", "RATE_LIMITED"), { retryAfterMs });
export const payloadTooLarge = (max: number) => new HttpError(413, `Body exceeds ${max} bytes`, "PAYLOAD_TOO_LARGE");

export function errorResponse(err: unknown, requestId?: string) {
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {};
    const retry = (err as HttpError & { retryAfterMs?: number }).retryAfterMs;
    if (retry) headers["Retry-After"] = String(Math.ceil(retry / 1000));
    return NextResponse.json(
      { error: err.message, code: err.code, requestId },
      { status: err.status, headers },
    );
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return NextResponse.json({ error: `${where}${issue?.message ?? "Invalid input"}`, code: "VALIDATION", requestId }, { status: 400 });
  }
  return NextResponse.json(
    { error: "Internal server error", code: "INTERNAL", requestId },
    { status: 500 },
  );
}

/** Read and parse a JSON body with a hard byte cap (defends against oversized uploads). */
export async function readJson<T = unknown>(req: Request, maxBytes = 1_000_000): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw payloadTooLarge(maxBytes);
  const text = await req.text();
  if (text.length > maxBytes) throw payloadTooLarge(maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest("Malformed JSON body", "BAD_JSON");
  }
}
