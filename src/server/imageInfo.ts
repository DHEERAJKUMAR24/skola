import dns from "node:dns/promises";
import net from "node:net";

export type ImageKind = "png" | "jpeg" | "webp" | "gif";

/** Pixel size read from the file header, or null when the file is not a well-formed image. */
export function imageSize(
  b: Buffer,
  kind: ImageKind
): { width: number; height: number } | null {
  try {
    let size: { width: number; height: number } | null = null;
    if (kind === "png" && b.length >= 24)
      size = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    else if (kind === "gif" && b.length >= 10)
      size = { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    else if (kind === "jpeg") size = jpegSize(b);
    else if (kind === "webp") size = webpSize(b);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

function jpegSize(b: Buffer) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    // Start-of-frame markers carry the size (not C4 DHT, C8 JPG, CC DAC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) i += 2;
    else i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function webpSize(b: Buffer) {
  const chunk = b.subarray(12, 16).toString("latin1");
  if (chunk === "VP8 ")
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  if (chunk === "VP8L")
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height:
        1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  if (chunk === "VP8X")
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

// ---- downloading a picture from a link (file references from AI clients) ---------------------

/** Swappable in tests. */
export const netDeps = {
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  lookup: (host: string) => dns.lookup(host, { all: true }),
};

/** Loopback, private, link-local, carrier-grade NAT, multicast and cloud metadata addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("ff")
  );
}

export class FetchImageError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Downloads a picture from a public https link: no logins in the link, no redirects, no private
 * addresses, a size cap and a timeout.
 * shortcut: the address is checked, then the host name is fetched again, so a hostile DNS server
 * could in theory answer differently the second time; pin the checked address if this ever fetches
 * for untrusted tenants.
 */
export async function fetchImage(
  raw: string,
  maxBytes: number
): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchImageError(
      "invalid_url",
      "the image link is not a valid URL"
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new FetchImageError(
      "invalid_url",
      "the image link must be a plain https link (no login, no custom port)"
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host)
    ? [{ address: host }]
    : await netDeps.lookup(host).catch(() => {
        throw new FetchImageError("download_failed", `could not find ${host}`);
      });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
    throw new FetchImageError(
      "blocked_address",
      "the image link points to a private or local address"
    );
  const res = await netDeps
    .fetch(url.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
    })
    .catch((e: Error) => {
      throw new FetchImageError(
        "download_failed",
        `the image could not be downloaded (${e.message}); redirects are not followed, so use the final link`
      );
    });
  if (!res.ok)
    throw new FetchImageError(
      "download_failed",
      `the image link answered HTTP ${res.status}; a temporary link may have expired`
    );
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes)
    throw new FetchImageError(
      "image_too_large",
      `the image is ${declared} bytes; the limit is ${maxBytes}`
    );
  const chunks: Buffer[] = [];
  let total = 0;
  if (!res.body)
    throw new FetchImageError("download_failed", "the image link sent no data");
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += part.length;
    if (total > maxBytes)
      throw new FetchImageError(
        "image_too_large",
        `the image is larger than the limit of ${maxBytes} bytes`
      );
    chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks);
}
