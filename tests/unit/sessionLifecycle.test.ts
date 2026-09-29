import { describe, it, expect } from "vitest";
import { acceptsEntries, canTransition, isActive, timerTransition } from "@/lib/sessions/lifecycle";

const T = 1_000_000_000;

describe("session lifecycle", () => {
  it("allows the spec's edges only", () => {
    expect(canTransition("RUNNING", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "RUNNING")).toBe(true);
    expect(canTransition("AWAITING_EXTENSION", "RUNNING")).toBe(true);
    expect(canTransition("ENDED", "RUNNING")).toBe(false);
    expect(canTransition("HALTED", "RUNNING")).toBe(false);
    expect(canTransition("ENDING", "RUNNING")).toBe(false);
  });
  it("only RUNNING opens entries; terminal states are not active", () => {
    expect(acceptsEntries("RUNNING")).toBe(true);
    expect(acceptsEntries("PAUSED")).toBe(false);
    expect(acceptsEntries("AWAITING_EXTENSION")).toBe(false);
    expect(isActive("AWAITING_EXTENSION")).toBe(true);
    expect(isActive("ENDED")).toBe(false);
  });
  it("prompts at endsAt and times out after the extension window", () => {
    const base = { endsAt: T, extensionPromptAt: null, extensionTimeoutMin: 5 };
    expect(timerTransition({ ...base, status: "RUNNING", now: T - 1 })).toBeNull();
    expect(timerTransition({ ...base, status: "RUNNING", now: T })).toBe("PROMPT_EXTENSION");
    expect(timerTransition({ ...base, status: "PAUSED", now: T + 5 })).toBe("PROMPT_EXTENSION");
    expect(timerTransition({ ...base, status: "AWAITING_EXTENSION", extensionPromptAt: T + 1_000, now: T + 1_000 + 4 * 60_000 })).toBeNull();
    expect(timerTransition({ ...base, status: "AWAITING_EXTENSION", extensionPromptAt: T + 1_000, now: T + 1_000 + 5 * 60_000 })).toBe("EXTENSION_TIMEOUT");
    expect(timerTransition({ ...base, status: "ENDED", now: T * 2 })).toBeNull();
  });
});
