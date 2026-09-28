import type { z } from "zod";
import { AiError } from "./errors";
import type { CompletionResult } from "./providers/types";

function stripFences(text: string): string {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fenced ? fenced[1] : t;
}

/**
 * Normalized provider result → validated data, or a typed AiError. Never parses a truncated or
 * refused answer, and never lets a structurally wrong answer reach the UI.
 */
export function parseModelJson<S extends z.ZodType>(result: CompletionResult, schema: S): z.output<S> {
  if (result.finishReason === "refusal") throw new AiError("AI_REFUSED", result.refusal);
  if (result.finishReason === "length") throw new AiError("AI_TRUNCATED");
  if (!result.text) throw new AiError("AI_BAD_JSON", "empty content");

  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(result.text));
  } catch {
    throw new AiError("AI_BAD_JSON", result.text.slice(0, 200));
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AiError("AI_SCHEMA", issues);
  }
  return parsed.data;
}
