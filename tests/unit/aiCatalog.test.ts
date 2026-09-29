import { describe, it, expect } from "vitest";
import { estimateCostUsd, findModel, resolveModel, type AiSettings } from "@/lib/ai/catalog";

const settings: AiSettings = {
  provider: "openai", model: "gpt-4o",
  visionProvider: "openai", visionModel: "gpt-4o",
  defaultDailyTokenQuota: 200_000,
};
const all = new Set(["openai", "anthropic", "openrouter", "deepseek"] as const);

describe("model catalog", () => {
  it("prices a call from per-million rates", () => {
    // gpt-4o: $2.50 in / $10 out per 1M
    expect(estimateCostUsd(findModel("openai", "gpt-4o")!, 1_000_000, 100_000)).toBeCloseTo(3.5, 6);
    // claude-opus-5: $5 / $25
    expect(estimateCostUsd(findModel("anthropic", "claude-opus-5")!, 2_000, 1_000)).toBeCloseTo(0.035, 6);
  });
  it("knows which models accept images", () => {
    expect(findModel("deepseek", "deepseek-v4-pro")!.vision).toBe(false);
    expect(findModel("deepseek", "deepseek-flash")!.vision).toBe(true);
  });
});

describe("resolveModel", () => {
  it("uses the admin default when the user has no preference", () => {
    expect(resolveModel({ settings, configured: all, needsVision: false })).toMatchObject({ provider: "openai", model: "gpt-4o" });
  });
  it("honours the user's preference when that provider is configured", () => {
    const r = resolveModel({ settings, configured: all, needsVision: false, userPref: { provider: "anthropic", model: "claude-sonnet-5" } });
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5" });
  });
  it("ignores a preference for a provider without an API key", () => {
    const r = resolveModel({ settings, configured: new Set(["openai"]), needsVision: false, userPref: { provider: "anthropic", model: "claude-opus-5" } });
    expect(r.provider).toBe("openai");
  });
  it("ignores unknown model ids instead of sending them upstream", () => {
    const r = resolveModel({ settings, configured: all, needsVision: false, userPref: { provider: "openai", model: "gpt-9-ultra" } });
    expect(r.model).toBe("gpt-4o");
  });
  it("switches to the vision model when the chosen model cannot read images", () => {
    const r = resolveModel({ settings, configured: all, needsVision: true, userPref: { provider: "deepseek", model: "deepseek-v4-pro" } });
    expect(r).toMatchObject({ provider: "openai", model: "gpt-4o", visionFallback: true });
  });
  it("a per-call override (session agent role) beats the user's preference", () => {
    const r = resolveModel({ settings, configured: all, needsVision: false, override: { provider: "deepseek", model: "deepseek-flash" }, userPref: { provider: "anthropic", model: "claude-sonnet-5" } });
    expect(r).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
  });
  it("an unusable override falls back to the user's preference", () => {
    const r = resolveModel({ settings, configured: new Set(["openai", "anthropic"]), needsVision: false, override: { provider: "deepseek", model: "deepseek-flash" }, userPref: { provider: "anthropic", model: "claude-sonnet-5" } });
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5" });
  });
  it("fails clearly when no provider is configured at all", () => {
    expect(() => resolveModel({ settings, configured: new Set(), needsVision: false })).toThrow(expect.objectContaining({ code: "AI_NOT_CONFIGURED" }));
  });
  it("falls back to any configured model when the defaults point at an unconfigured provider", () => {
    const r = resolveModel({ settings: { ...settings, provider: "anthropic", model: "claude-opus-5" }, configured: new Set(["openai"]), needsVision: false });
    expect(r.provider).toBe("openai");
  });
});
