import {
  IO_MAX_URL_CHARS,
  isImageUrl,
} from "../logic/type-implementations/image-occlusion/types";

/** Stored pictures must stay small: they sync inside the note row (see IO_MAX_IMAGE_CHARS). */
export const MAX_IMAGE_BYTES = 400_000;

export type ImageKind = "png" | "jpeg" | "webp" | "gif";

/** What the file really is, from its first bytes, whatever its name or header claims. */
export function sniffImage(b: Buffer): ImageKind | null {
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  )
    return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "jpeg";
  if (
    b.length > 12 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")))
    return "gif";
  return null;
}

/** Checks a picture's bytes and returns the data URL the app stores. */
export function toDataUrl(b: Buffer): string {
  const kind = sniffImage(b);
  if (!kind) throw new Error("the image must be a PNG, JPEG, WebP or GIF file");
  if (b.length > MAX_IMAGE_BYTES)
    throw new Error(
      `the image is ${Math.round(b.length / 1000)} KB; shrink it to under ${MAX_IMAGE_BYTES / 1000} KB (about 1200 px wide) first`
    );
  return `data:image/${kind};base64,${b.toString("base64")}`;
}

/** Accepts a data URL or bare base64 text. */
export function parseImageInput(s: string, maxBytes = MAX_IMAGE_BYTES): Buffer {
  const m = /^data:image\/[a-z+.-]+;base64,([\s\S]*)$/i.exec(s.trim());
  const b64 = (m ? m[1] : s).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))
    throw new Error("image is not valid base64");
  // Cheap size check before decoding something huge.
  if (b64.length > (maxBytes * 4) / 3 + 8)
    throw new Error(
      `the image is over ${Math.round(maxBytes / 1000)} KB; shrink it first`
    );
  return Buffer.from(b64, "base64");
}

/**
 * Checks an image link for an image-occlusion card. Skola does not download the picture: the link
 * is stored as it is and the picture is shown straight from it, so it must stay reachable.
 */
export function checkImageUrl(raw: string): string {
  const url = raw.trim();
  if (!isImageUrl(url))
    throw new Error(
      `image_url must be an https link without a login, up to ${IO_MAX_URL_CHARS} characters`
    );
  return url;
}
