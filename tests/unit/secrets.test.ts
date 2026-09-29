import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, last4, masterKey } from "@/lib/secrets/crypto";

const key = randomBytes(32);

describe("exchange secret encryption", () => {
  it("round-trips and never stores the plain text", () => {
    const enc = encryptSecret("my-api-secret-123", key);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain("my-api-secret");
    expect(decryptSecret(enc, key)).toBe("my-api-secret-123");
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key)); // random IV
  });
  it("detects tampering and a wrong key", () => {
    const enc = encryptSecret("secret", key);
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 1;
    expect(() => decryptSecret([parts[0], parts[1], parts[2], ct.toString("base64")].join(":"), key)).toThrow(/decrypted/);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow(/decrypted/);
    expect(() => decryptSecret("v9:a:b:c", key)).toThrow(/format/);
  });
  it("fails closed without a valid master key", () => {
    expect(masterKey("")).toBeNull();
    expect(masterKey(Buffer.alloc(16).toString("base64"))).toBeNull();
    expect(masterKey(key.toString("base64"))?.length).toBe(32);
    expect(() => encryptSecret("x", null)).toThrow(/EXCHANGE_KEY_SECRET/);
  });
  it("shows only the last four characters", () => {
    expect(last4(" abcdefgh ")).toBe("efgh");
  });
});
