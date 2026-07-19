export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Downscale a photo to the journal's standard bound (longest edge 1280px,
 * matching the Telegram pipeline) and re-encode as JPEG. EXIF orientation is
 * baked in by the browser decode step.
 */
export async function resizeImage(file: File, maxDim = 1280, quality = 0.85): Promise<ResizedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))),
        "image/jpeg",
        quality,
      ),
    );
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}
