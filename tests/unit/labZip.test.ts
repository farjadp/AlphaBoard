import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { readSingleZipEntry } from "@/lib/lab/data/zip";

/** A minimal one-entry zip (local header + data), as data.binance.vision ships them. */
function zipOf(name: string, text: string, method: 0 | 8 = 8): Buffer {
  const raw = Buffer.from(text);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(method, 8);
  h.writeUInt32LE(0, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22);
  h.writeUInt16LE(Buffer.byteLength(name), 26); h.writeUInt16LE(0, 28);
  return Buffer.concat([h, Buffer.from(name), data, Buffer.from([0x50, 0x4b, 0x01, 0x02])]);
}

describe("zip — single entry", () => {
  it("inflates a deflated entry", () => {
    expect(readSingleZipEntry(zipOf("BTCUSDT-1h-2021-01.csv", "1,2,3\n4,5,6\n"))).toBe("1,2,3\n4,5,6\n");
  });
  it("reads a stored entry", () => {
    expect(readSingleZipEntry(zipOf("a.csv", "x", 0))).toBe("x");
  });
  it("rejects something that is not a zip", () => {
    expect(() => readSingleZipEntry(Buffer.from("<Error>NoSuchKey</Error>"))).toThrow(/not a zip/);
  });
});
