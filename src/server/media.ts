import { createHash } from "node:crypto";
import type { Db } from "./db";
import { sniffImage } from "./mcpImage";
import { objectUrl, r2Config } from "./r2";

/** A picture is shrunk in the browser first, so anything bigger than this is not from the app. */
export const MAX_MEDIA_BYTES = 15_000_000;
/** Soft cap per account; R2's free tier holds 10 GB in total. */
export const MAX_USER_BYTES = 200_000_000;
export const MEDIA_TYPES = [
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
];
const UPLOAD_LINK_SECONDS = 600;
const READ_LINK_SECONDS = 3600;

export class MediaError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/** Swappable in tests; talks to R2 with presigned links. */
export const r2Deps = {
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
};

export const isSha = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
export const mediaKey = (userId: string, sha: string) => `u/${userId}/${sha}`;
export const sha256Of = (b: Buffer) =>
  createHash("sha256").update(b).digest("hex");

function need() {
  const cfg = r2Config();
  if (!cfg) throw new MediaError("Picture storage is not set up", 501);
  return cfg;
}

export const mediaEnabled = () => r2Config() !== null;

async function used(db: Db, userId: string) {
  const { rows } = await db.query<{ n: string }>(
    "SELECT COALESCE(SUM(size), 0) AS n FROM media_objects WHERE user_id = $1",
    [userId]
  );
  return Number(rows[0].n);
}

/**
 * Starts an upload. A picture the user already has is not uploaded again; otherwise the browser
 * gets a short-lived link to PUT the bytes to R2 directly, with the content type the link signs.
 */
export async function requestUpload(
  db: Db,
  userId: string,
  b: { sha256: unknown; size: unknown; type: unknown }
) {
  const cfg = need();
  if (!isSha(b.sha256))
    throw new MediaError("sha256 must be 64 hex characters");
  const size = Number(b.size);
  if (!Number.isInteger(size) || size < 1 || size > MAX_MEDIA_BYTES)
    throw new MediaError(
      `Pictures are limited to ${MAX_MEDIA_BYTES / 1_000_000} MB`,
      413
    );
  if (typeof b.type !== "string" || !MEDIA_TYPES.includes(b.type))
    throw new MediaError("Use a PNG, JPEG, WebP or GIF picture");

  const { rows } = await db.query<{ confirmed: boolean }>(
    "SELECT confirmed FROM media_objects WHERE user_id = $1 AND sha256 = $2",
    [userId, b.sha256]
  );
  if (rows[0]?.confirmed) return { exists: true as const };
  if ((await used(db, userId)) + size > MAX_USER_BYTES)
    throw new MediaError("Picture storage is full", 413);

  await db.query(
    `INSERT INTO media_objects (user_id, sha256, size, type, confirmed, created_at)
     VALUES ($1, $2, $3, $4, false, $5)
     ON CONFLICT (user_id, sha256) DO UPDATE SET size = EXCLUDED.size, type = EXCLUDED.type`,
    [userId, b.sha256, size, b.type, Date.now()]
  );
  const headers = { "content-type": b.type };
  return {
    exists: false as const,
    uploadUrl: objectUrl(
      cfg,
      "PUT",
      mediaKey(userId, b.sha256),
      UPLOAD_LINK_SECONDS,
      headers
    ),
    headers,
  };
}

/** After the browser's PUT: check R2 really has an object of the promised size, then accept it. */
export async function confirmUpload(db: Db, userId: string, sha: unknown) {
  const cfg = need();
  if (!isSha(sha)) throw new MediaError("sha256 must be 64 hex characters");
  const { rows } = await db.query<{ size: number }>(
    "SELECT size FROM media_objects WHERE user_id = $1 AND sha256 = $2",
    [userId, sha]
  );
  if (!rows[0]) throw new MediaError("Start the upload first", 404);
  const key = mediaKey(userId, sha);
  const head = await r2Deps.fetch(objectUrl(cfg, "HEAD", key, 60), {
    method: "HEAD",
  });
  if (!head.ok) throw new MediaError("The picture was not uploaded", 409);
  if (Number(head.headers.get("content-length")) !== rows[0].size) {
    // Wrong size: remove it so a bad object is never served.
    await r2Deps.fetch(objectUrl(cfg, "DELETE", key, 60), { method: "DELETE" });
    await db.query(
      "DELETE FROM media_objects WHERE user_id = $1 AND sha256 = $2",
      [userId, sha]
    );
    throw new MediaError(
      "The uploaded picture does not match what was announced",
      409
    );
  }
  await db.query(
    "UPDATE media_objects SET confirmed = true WHERE user_id = $1 AND sha256 = $2",
    [userId, sha]
  );
  return { ok: true as const };
}

/** A short-lived link that shows or downloads one of the user's own pictures. */
export async function presignRead(db: Db, userId: string, sha: unknown) {
  const cfg = need();
  if (!isSha(sha)) throw new MediaError("sha256 must be 64 hex characters");
  const { rows } = await db.query<{ confirmed: boolean }>(
    "SELECT confirmed FROM media_objects WHERE user_id = $1 AND sha256 = $2",
    [userId, sha]
  );
  if (!rows[0]?.confirmed) throw new MediaError("Picture not found", 404);
  return {
    url: objectUrl(cfg, "GET", mediaKey(userId, sha), READ_LINK_SECONDS),
    expiresAt: Date.now() + READ_LINK_SECONDS * 1000,
  };
}

/** Server-side upload, for pictures that arrive over MCP as bytes. Returns the sha256. */
export async function storeBytes(db: Db, userId: string, bytes: Buffer) {
  const kind = sniffImage(bytes);
  if (!kind)
    throw new MediaError("the image must be a PNG, JPEG, WebP or GIF file");
  if (bytes.length > MAX_MEDIA_BYTES)
    throw new MediaError(
      `the image is over ${MAX_MEDIA_BYTES / 1_000_000} MB`,
      413
    );
  const sha = sha256Of(bytes);
  const type = `image/${kind}`;
  const up = await requestUpload(db, userId, {
    sha256: sha,
    size: bytes.length,
    type,
  });
  if (up.exists) return sha;
  const put = await r2Deps.fetch(up.uploadUrl, {
    method: "PUT",
    headers: up.headers,
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw new MediaError("The picture could not be stored", 502);
  await confirmUpload(db, userId, sha);
  return sha;
}

/** `media:<sha256>`, the reference a note keeps instead of the picture itself. */
export const MEDIA_REF = /^media:([0-9a-f]{64})$/;
