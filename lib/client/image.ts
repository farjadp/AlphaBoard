"use client";

/** Must stay ≤ the server cap in lib/http/images.ts (MAX_IMAGE_BYTES). */
export const MAX_UPLOAD_BYTES = 1_500_000;

export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not read the image"));
    r.readAsDataURL(blob);
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), type, quality),
  );
}

/**
 * Downscale + re-encode a screenshot before upload. Phone screenshots are often 3–8 MB; the
 * models read text perfectly well at 1600px, and this keeps request bodies (and browser storage)
 * small. WebP where the browser can encode it, JPEG otherwise.
 */
export async function compressImage(
  file: File,
  { maxDim = 1600, maxBytes = MAX_UPLOAD_BYTES }: { maxDim?: number; maxBytes?: number } = {},
): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new Error("Please choose a PNG, JPEG or WebP image.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    for (let round = 0; round < 6; round++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.85, 0.72, 0.6]) {
        let blob = await encode(canvas, "image/webp", quality);
        if (blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg", quality);
        if (blob.size <= maxBytes) return blobToDataUrl(blob);
      }
      scale *= 0.75;
    }
    throw new Error("The image is too large even after compression. Crop it and try again.");
  } finally {
    bitmap.close();
  }
}
