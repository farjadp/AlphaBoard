import type { z } from "zod";
import { AiError } from "./errors";

export interface ChatCompletionLike {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
}

function stripFences(text: string): string {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fenced ? fenced[1] : t;
}

/**
 * Turns a chat completion into validated data or a typed AiError.
 * v1 did `JSON.parse(choices[0].message.content)` with no checks: a truncated answer or a
 * refusal became an opaque 500, and a structurally wrong answer reached the UI.
 */
export function parseCompletionJson<S extends z.ZodType>(completion: ChatCompletionLike, schema: S): z.output<S> {
  const choice = completion?.choices?.[0];
  if (!choice?.message) throw new AiError("AI_BAD_JSON", "no choices in completion");
  if (choice.message.refusal) throw new AiError("AI_REFUSED", choice.message.refusal);
  if (choice.finish_reason === "length") throw new AiError("AI_TRUNCATED");
  if (choice.finish_reason === "content_filter") throw new AiError("AI_REFUSED", "content_filter");

  const content = choice.message.content;
  if (!content) throw new AiError("AI_BAD_JSON", "empty content");

  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(content));
  } catch {
    throw new AiError("AI_BAD_JSON", content.slice(0, 200));
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AiError("AI_SCHEMA", issues);
  }
  return parsed.data;
}
