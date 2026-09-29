import { describe, it, expect } from "vitest";
import { parseImageDataUrl } from "@/lib/http/images";

const tinyPng = "data:image/png;base64," + Buffer.from("fake-png-bytes").toString("base64");

describe("parseImageDataUrl", () => {
  it("accepts png/jpeg/webp data URLs and reports decoded size", () => {
    const out = parseImageDataUrl(tinyPng, 1024);
    expect(out.mime).toBe("image/png");
    expect(out.bytes).toBe(Buffer.from("fake-png-bytes").length);
  });
  it("rejects remote URLs (the model provider would fetch them)", () => {
    expect(() => parseImageDataUrl("https://evil.example/x.png", 1024)).toThrow(/data URL/);
  });
  it("rejects non-image and svg payloads", () => {
    expect(() => parseImageDataUrl("data:text/html;base64,PGgxPg==", 1024)).toThrow();
    expect(() => parseImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=", 1024)).toThrow();
  });
  it("rejects images over the byte cap", () => {
    expect(() => parseImageDataUrl(tinyPng, 4)).toThrow(/too large/i);
  });
});
