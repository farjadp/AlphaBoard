import { HttpError } from "@/lib/http/errors";

export type AiErrorCode =
  | "AI_NOT_CONFIGURED" | "AI_UPSTREAM" | "AI_RATE_LIMITED" | "AI_TIMEOUT" | "AI_TRUNCATED"
  | "AI_REFUSED" | "AI_BAD_JSON" | "AI_SCHEMA" | "AI_QUOTA";

const STATUS: Record<AiErrorCode, number> = {
  AI_NOT_CONFIGURED: 503, AI_UPSTREAM: 502, AI_RATE_LIMITED: 503, AI_TIMEOUT: 504, AI_TRUNCATED: 502,
  AI_REFUSED: 422, AI_BAD_JSON: 502, AI_SCHEMA: 502, AI_QUOTA: 429,
};

/** User-facing messages. Details go to the server log, never to the client. */
const MESSAGE: Record<AiErrorCode, string> = {
  AI_NOT_CONFIGURED: "AI analysis is not configured on this server.",
  AI_UPSTREAM: "The AI provider returned an error. Please try again.",
  AI_RATE_LIMITED: "The AI provider is busy right now. Please try again in a minute.",
  AI_QUOTA: "You have used today's AI allowance. It resets at 00:00 UTC; an administrator can raise your limit.",
  AI_TIMEOUT: "The AI provider took too long to respond. Please try again.",
  AI_TRUNCATED: "The AI response was cut off before it finished. Please try again.",
  AI_REFUSED: "The AI declined to answer this request.",
  AI_BAD_JSON: "The AI returned an unreadable response. Please try again.",
  AI_SCHEMA: "The AI returned an incomplete or inconsistent analysis. Please try again.",
};

export class AiError extends HttpError {
  constructor(public readonly aiCode: AiErrorCode, public readonly detail?: string) {
    super(STATUS[aiCode], MESSAGE[aiCode], aiCode);
    this.name = "AiError";
  }
}
