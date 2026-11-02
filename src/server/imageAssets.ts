import { createHash } from "node:crypto";
import {
  FetchImageError,
  type ImageKind,
  fetchImage,
  imageSize,
} from "./imageInfo";
import type { Ctx } from "./mcpData";
import { MAX_IMAGE_BYTES, parseImageInput, sniffImage } from "./mcpImage";
import { mediaEnabled, storeBytes } from "./media";

/** One uploaded picture. A request on Vercel is about 4.5 MB, so bigger ones come as a link. */
export const ASSET_MAX_BYTES = 8_000_000;
export const ASSET_USER_BYTES = 50_000_000;

/** An error an AI agent can act on: a stable code, what is wrong, and what to do about it. */
export class ImageError extends Error {
  constructor(
    public code: string,
    message: string,
    hint?: string
  ) {
    super(`[${code}] ${message}${hint ? ` ${hint}` : ""}`);
  }
}

export interface AssetInfo {
  image_asset_id: string;
  mime_type: string;
  size_bytes: number;
  width: number;
  height: number;
}

const assetId = (sha: string) => `asset_${sha.slice(0, 32)}`;
export const ASSET_ID = /^asset_[0-9a-f]{32}$/;

/** Where the bytes of a picture may come from. */
export interface ImageSource {
  /** A data URL or bare base64 text. */
  image_base64?: unknown;
  /** A file reference from an AI client: { download_url, file_id, ... }, or base64 text. */
  image?: unknown;
  /** A public https link the picture is downloaded from. */
  image_url?: unknown;
}

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Bytes of a picture from base64, a data URL, a file reference or a link. */
export async function readImageSource(
  s: ImageSource,
  maxBytes = ASSET_MAX_BYTES
): Promise<Buffer> {
  const b64 =
    asText(s.image_base64) ||
    (typeof s.image === "string" ? asText(s.image) : "");
  const ref =
    s.image && typeof s.image === "object"
      ? (s.image as Record<string, unknown>)
      : null;
  const link =
    asText(s.image_url) ||
    (ref &&
      (asText(ref.download_url) || asText(ref.url) || asText(ref.file_url)));
  try {
    if (link) return await fetchImage(link, maxBytes);
    if (ref && (asText(ref.base64) || asText(ref.data)))
      return parseImageInput(asText(ref.base64) || asText(ref.data), maxBytes);
    if (b64) {
      if (/^https?:\/\//i.test(b64)) return await fetchImage(b64, maxBytes);
      return parseImageInput(b64, maxBytes);
    }
  } catch (e) {
    if (e instanceof FetchImageError) throw new ImageError(e.code, e.message);
    throw new ImageError(
      /over|shrink/.test((e as Error).message)
        ? "image_too_large"
        : "invalid_image_data",
      (e as Error).message,
      "Send the picture as base64 or a data URL, or as an https link."
    );
  }
  if (ref)
    throw new ImageError(
      "unsupported_image_reference",
      `the image reference has no download_url (it has: ${Object.keys(ref).join(", ") || "nothing"}).`,
      "Pass image_base64 (a data URL) or a public https image_url instead; an internal file id cannot be read by Skola."
    );
  throw new ImageError(
    "missing_image",
    "no picture was given.",
    "Give image_asset_id (from upload_image_asset), image_base64, image (a file reference with download_url) or image_url."
  );
}

/** Validates and stores a picture for this user. Same bytes give the same id. */
export async function saveAsset(ctx: Ctx, bytes: Buffer): Promise<AssetInfo> {
  const kind = sniffImage(bytes);
  if (!kind)
    throw new ImageError(
      "invalid_image",
      "this is not a PNG, JPEG, WebP or GIF file, or the file is corrupted.",
      "Export the picture as PNG or JPEG and try again."
    );
  if (bytes.length > ASSET_MAX_BYTES)
    throw new ImageError(
      "image_too_large",
      `the picture is ${bytes.length} bytes; the limit is ${ASSET_MAX_BYTES}.`,
      "Shrink it (about 1600 px wide is plenty) or lower the quality."
    );
  const size = imageSize(bytes, kind);
  if (!size)
    throw new ImageError(
      "invalid_image",
      "the file looks like an image but its header is damaged, so its size cannot be read."
    );
  const sha = createHash("sha256").update(bytes).digest("hex");
  const id = assetId(sha);
  const { rows } = await ctx.db.query<{ n: string; has: boolean }>(
    `SELECT COALESCE(SUM(size), 0) AS n, bool_or(id = $2) AS has
       FROM mcp_image_assets WHERE user_id = $1`,
    [ctx.userId, id]
  );
  if (!rows[0]?.has) {
    if (Number(rows[0]?.n ?? 0) + bytes.length > ASSET_USER_BYTES)
      throw new ImageError(
        "storage_full",
        `uploaded pictures use ${rows[0].n} of ${ASSET_USER_BYTES} bytes.`,
        "Make cards from the pictures you already uploaded, or use image_url links."
      );
    await ctx.db
      .query(
        `INSERT INTO mcp_image_assets (user_id, id, mime, size, width, height, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
        [
          ctx.userId,
          id,
          `image/${kind}`,
          bytes.length,
          size.width,
          size.height,
          bytes,
          ctx.now,
        ]
      )
      .catch((e: Error) => {
        throw new ImageError(
          "storage_failed",
          `the picture could not be saved (${e.message}).`,
          "Retry once; if it keeps failing, use an image_url link instead."
        );
      });
  }
  return {
    image_asset_id: id,
    mime_type: `image/${kind}`,
    size_bytes: bytes.length,
    width: size.width,
    height: size.height,
  };
}

export interface LoadedAsset extends AssetInfo {
  data: Buffer;
  kind: ImageKind;
}

/** Only the owner's assets are visible; anyone else's id looks like a missing one. */
export async function loadAsset(ctx: Ctx, id: unknown): Promise<LoadedAsset> {
  if (typeof id !== "string" || !ASSET_ID.test(id))
    throw new ImageError(
      "invalid_asset_id",
      "image_asset_id must look like asset_ followed by 32 hex characters.",
      "Use the id upload_image_asset returned."
    );
  const { rows } = await ctx.db.query<{
    mime: string;
    size: number;
    width: number;
    height: number;
    data: Uint8Array;
  }>(
    "SELECT mime, size, width, height, data FROM mcp_image_assets WHERE user_id = $1 AND id = $2",
    [ctx.userId, id]
  );
  const r = rows[0];
  if (!r)
    throw new ImageError(
      "asset_not_found",
      `no uploaded picture has the id ${id}.`,
      "Upload the picture first with upload_image_asset."
    );
  return {
    image_asset_id: id,
    mime_type: r.mime,
    size_bytes: r.size,
    width: r.width,
    height: r.height,
    data: Buffer.from(r.data),
    kind: r.mime.slice(6) as ImageKind,
  };
}

/** What a note keeps for the picture: an R2 reference when storage is set up, else the bytes inline. */
export async function noteImageFor(
  ctx: Ctx,
  a: { data: Buffer; kind: ImageKind }
): Promise<{ image: string; storage: "r2" | "inline" }> {
  if (mediaEnabled())
    return {
      image: `media:${await storeBytes(ctx.db, ctx.userId, a.data)}`,
      storage: "r2",
    };
  if (a.data.length > MAX_IMAGE_BYTES)
    throw new ImageError(
      "image_too_large_for_inline",
      `the picture is ${a.data.length} bytes; without picture storage a card can hold ${MAX_IMAGE_BYTES}.`,
      "Upload a smaller picture (about 1200 px wide), or pass a public https image_url."
    );
  return {
    image: `data:image/${a.kind};base64,${a.data.toString("base64")}`,
    storage: "inline",
  };
}
