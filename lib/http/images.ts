import { badRequest, HttpError } from "./errors";

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

export const MAX_IMAGE_BYTES = 1_500_000; // matches the client-side compression cap

/**
 * Accept only inline raster images. Remote URLs are rejected: the model provider would fetch
 * them on our behalf (an open fetch proxy billed to us). SVG is rejected (scriptable).
 */
export function parseImageDataUrl(value: unknown, maxBytes = MAX_IMAGE_BYTES): { mime: string; bytes: number } {
  if (typeof value !== "string" || !value.startsWith("data:")) {
    throw badRequest("Image must be an inline data URL (png, jpeg, webp or gif)", "IMAGE_FORMAT");
  }
  const m = DATA_URL.exec(value);
  if (!m) throw badRequest("Unsupported image data URL (png, jpeg, webp or gif only)", "IMAGE_FORMAT");
  const b64 = m[2];
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (bytes > maxBytes) {
    throw new HttpError(413, `Image too large (${Math.round(bytes / 1024)} KB, max ${Math.round(maxBytes / 1024)} KB)`, "IMAGE_TOO_LARGE");
  }
  return { mime: m[1], bytes };
}
