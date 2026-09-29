import { describe, it, expect } from "vitest";
import { disclaimerGate, safeNext } from "@/lib/legal/gate";

describe("disclaimerGate", () => {
  it("lets accepted users and signed-out visitors through (login is handled elsewhere)", () => {
    expect(disclaimerGate("/market/btc-usdt", { loggedIn: true, accepted: true })).toBe("allow");
    expect(disclaimerGate("/market/btc-usdt", { loggedIn: false, accepted: false })).toBe("allow");
  });
  it("sends signed-in users who have not accepted to /welcome, and blocks their API calls", () => {
    expect(disclaimerGate("/paper", { loggedIn: true, accepted: false })).toBe("redirect");
    expect(disclaimerGate("/api/paper/orders", { loggedIn: true, accepted: false })).toBe("forbid");
  });
  it("never gates the welcome page, legal pages, auth, health or the cron trigger", () => {
    for (const p of ["/welcome", "/legal", "/legal/terms", "/api/auth/session", "/api/auth/signout", "/api/health", "/api/cron/tick", "/login"]) {
      expect(disclaimerGate(p, { loggedIn: true, accepted: false })).toBe("allow");
    }
  });
});

describe("safeNext", () => {
  it("keeps same-site paths and rejects anything that could leave the site", () => {
    expect(safeNext("/paper?signal=abc")).toBe("/paper?signal=abc");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "", null, "/welcome"]) expect(safeNext(bad)).toBe("/market");
  });
});
