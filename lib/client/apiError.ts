"use client";

const HINTS: Record<string, string> = {
  AI_NOT_CONFIGURED: "AI analysis is not configured on the server (missing API key).",
  RATE_LIMITED: "Too many requests in a short time. Please wait a few minutes.",
  IMAGE_TOO_LARGE: "The image is too large. Please crop it and try again.",
  UNAUTHORIZED: "Your session expired. Please log in again.",
};

/** Human-readable message from our `{ error, code }` JSON error envelope. */
export async function apiErrorMessage(res: Response, fallback = "Request failed"): Promise<string> {
  try {
    const body = await res.json();
    return HINTS[body?.code] ?? body?.error ?? fallback;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}
