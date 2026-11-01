import { mediaEnabled, storeImage } from "./media";

/** Longest side of a stored picture, in pixels; plenty for a phone or a laptop screen. */
export const IMAGE_MAX_SIDE = 1400;
/** Kept in R2 (the server accepts up to 15 MB). */
const STORED_MAX_BYTES = 15_000_000;
/** Kept inside the note: the synced row stays small. */
const INLINE_MAX_BYTES = 400_000;

export type PreparedImage =
  | { ok: true; ref: string }
  | { ok: false; reason: "unreadable" | "too-large" };

/**
 * Re-encodes a picture as WebP at no more than IMAGE_MAX_SIDE pixels, lowering quality and size
 * until it fits `maxBytes`. "unreadable" means the browser cannot decode the file (HEIC, SVG in
 * some browsers, a corrupt file).
 */
export async function shrinkImage(
  file: Blob,
  maxBytes: number
): Promise<Blob | "unreadable" | "too-large"> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "unreadable";
  }
  let scale = Math.min(
    1,
    IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height)
  );
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/webp", quality)
    );
    if (blob && blob.size <= maxBytes) return blob;
    scale *= 0.8;
  }
  return "too-large";
}

/**
 * Turns a picked, pasted or dropped file into what a note stores: a `media:` reference when
 * picture storage is available (the bytes are kept on this device and uploaded to R2 in the
 * background), otherwise a small data URL.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const stored = await mediaEnabled();
  const shrunk = await shrinkImage(
    file,
    stored ? STORED_MAX_BYTES : INLINE_MAX_BYTES
  );
  if (typeof shrunk === "string") return { ok: false, reason: shrunk };
  return { ok: true, ref: await storeImage(shrunk) };
}
