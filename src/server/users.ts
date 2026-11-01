import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "./crypto";
import type { Db } from "./db";

export const MIN_PASSWORD = 10;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export class AuthError extends Error {
  constructor(
    public code: "invalid" | "exists" | "closed" | "locked" | "weak",
    message: string
  ) {
    super(message);
  }
}

export function checkPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD)
    throw new AuthError("weak", `Password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > 200) throw new AuthError("weak", "Password is too long");
}

export async function createUser(db: Db, emailRaw: string, password: string) {
  const email = normalizeEmail(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new AuthError("invalid", "Enter a valid email address");
  checkPassword(password);
  if (process.env.ALLOW_SIGNUP === "false") {
    const n = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM users");
    if (n.rows[0].n > 0) throw new AuthError("closed", "Sign-up is closed");
  }
  const id = randomUUID();
  const hash = await hashPassword(password);
  const res = await db.query(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [id, email, hash, Date.now()]
  );
  if (!res.rows.length) throw new AuthError("exists", "That email is already registered");
  return { id, email };
}

/** Returns the user, or null for any bad credentials (same answer for unknown email and wrong password). */
export async function verifyLogin(db: Db, emailRaw: string, password: string) {
  const email = normalizeEmail(emailRaw);
  const { rows } = await db.query<{
    id: string;
    password_hash: string;
    failed_logins: number;
    locked_until: string;
  }>("SELECT id, password_hash, failed_logins, locked_until FROM users WHERE email = $1", [email]);
  const u = rows[0];
  if (!u) {
    // Burn comparable time so unknown emails are not distinguishable by latency.
    await hashPassword(password);
    return null;
  }
  if (Number(u.locked_until) > Date.now()) throw new AuthError("locked", "Too many attempts, try again later");
  if (await verifyPassword(password, u.password_hash)) {
    if (u.failed_logins) await db.query("UPDATE users SET failed_logins = 0 WHERE id = $1", [u.id]);
    return { id: u.id, email };
  }
  const fails = u.failed_logins + 1;
  await db.query("UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1", [
    u.id,
    fails >= MAX_FAILS ? 0 : fails,
    fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0,
  ]);
  return null;
}

export async function getUserEmail(db: Db, userId: string) {
  const { rows } = await db.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
  return rows[0]?.email ?? null;
}
