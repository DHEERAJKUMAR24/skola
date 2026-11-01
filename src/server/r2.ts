import { createHash, createHmac } from "node:crypto";

/**
 * Cloudflare R2 speaks the S3 protocol, so requests are signed with AWS Signature V4 in the
 * query string ("presigned"). Done here in about fifty lines to avoid pulling in the AWS SDK.
 */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Replaces the Cloudflare address, for a local S3-compatible server. */
  endpoint?: string;
}

/** Null until all four settings exist; the app then falls back to keeping pictures inside notes. */
export function r2Config(
  env: Record<string, string | undefined> = process.env
): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
    env;
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET
  )
    return null;
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    endpoint: env.R2_ENDPOINT || undefined,
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding, which is stricter than encodeURIComponent.
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

export interface PresignInput {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  host: string;
  /** Path starting with "/", not yet encoded. */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Seconds the link stays valid. */
  expires: number;
  now?: Date;
  /** Headers the caller must send exactly as given, e.g. content-type. */
  headers?: Record<string, string>;
}

/** An S3-style presigned URL (SigV4, query string). */
export function presign(i: PresignInput): string {
  const stamp = (i.now ?? new Date())
    .toISOString()
    .replace(/[-:]|\.\d{3}/g, "");
  const date = stamp.slice(0, 8);
  const scope = `${date}/${i.region}/s3/aws4_request`;

  const headers: Record<string, string> = { host: i.host };
  for (const [k, v] of Object.entries(i.headers ?? {}))
    headers[k.toLowerCase()] = v.trim();
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${i.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(i.expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join("&");
  const canonicalPath = i.path.split("/").map(enc).join("/");
  const canonicalRequest = [
    i.method,
    canonicalPath,
    canonicalQuery,
    `${names.map((n) => `${n}:${headers[n]}`).join("\n")}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const toSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const key = hmac(
    hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, date), i.region), "s3"),
    "aws4_request"
  );
  const signature = hmac(key, toSign).toString("hex");
  return `https://${i.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** A presigned URL for one object of the configured bucket (path style, region "auto"). */
export function objectUrl(
  cfg: R2Config,
  method: PresignInput["method"],
  key: string,
  expires: number,
  headers?: Record<string, string>,
  now?: Date
): string {
  const host = cfg.endpoint
    ? new URL(cfg.endpoint).host
    : `${cfg.accountId}.r2.cloudflarestorage.com`;
  const url = presign({
    method,
    host,
    path: `/${cfg.bucket}/${key}`,
    region: "auto",
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expires,
    headers,
    now,
  });
  return cfg.endpoint?.startsWith("http://")
    ? url.replace(/^https:/, "http:")
    : url;
}
