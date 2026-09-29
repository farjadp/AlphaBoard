import { describe, it, expect } from "vitest";
import { z } from "zod";
import { errorResponse, badRequest } from "@/lib/http/errors";

describe("errorResponse", () => {
  it("maps invalid request bodies (zod) to 400 with the failing field", async () => {
    const r = z.object({ margin: z.number().positive() }).safeParse({ margin: -1 });
    const res = errorResponse(r.error, "rid");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION", error: expect.stringContaining("margin"), requestId: "rid" });
  });
  it("keeps HttpErrors and hides unknown errors", async () => {
    expect(errorResponse(badRequest("x", "X")).status).toBe(400);
    const res = errorResponse(new Error("secret detail"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
