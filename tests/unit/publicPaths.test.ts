import { describe, it, expect } from "vitest";
import { isPublicPath } from "@/auth.config";

describe("isPublicPath", () => {
  it("lets the EA routes through the proxy (they check the device token)", () => {
    expect(isPublicPath("/api/mt5/heartbeat")).toBe(true);
    expect(isPublicPath("/api/mt5/signals/next")).toBe(true);
    expect(isPublicPath("/api/mt5/signals/abc/report")).toBe(true);
  });
  it("keeps the Signal Desk behind login", () => {
    expect(isPublicPath("/api/signal-desk")).toBe(false);
    expect(isPublicPath("/signal-desk")).toBe(false);
    expect(isPublicPath("/api/mt5")).toBe(false);
  });
});
