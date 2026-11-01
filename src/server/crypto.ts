import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

export const sha256 = (s: string) =>
  createHash("sha256").update(s).digest("hex");

export const randomToken = (prefix: string) =>
  `${prefix}_${randomBytes(32).toString("base64url")}`;

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmac(key: string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

const derive = (
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number
) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEYLEN,
      { N: n, r, p },
      (err, key) => (err ? reject(err) : resolve(key))
    )
  );

/** Format: scrypt$N$r$p$salt$hash, so parameters can change later without breaking old hashes. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const key = await derive(password, Buffer.from(salt, "base64"), +n, +r, +p);
  return safeEqual(key.toString("base64"), hash);
}
