/** Read the first (only) entry of a zip — data.binance.vision ships one CSV per zip. */
import { inflateRawSync } from "node:zlib";
import { LabDataError } from "./encode";

export function readSingleZipEntry(buf: Buffer): string {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new LabDataError("not a zip file");
  const flags = buf.readUInt16LE(6);
  const method = buf.readUInt16LE(8);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  // Bit 3: sizes live in a data descriptor after the data; inflateRaw finds the end by itself.
  if (flags & 0x08 || size === 0) size = buf.length - start;
  const data = buf.subarray(start, start + size);
  if (method === 0) return data.toString("utf8");
  if (method === 8) return inflateRawSync(data).toString("utf8");
  throw new LabDataError(`unsupported zip compression (${method})`);
}
