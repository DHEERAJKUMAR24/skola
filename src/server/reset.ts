import { randomInt } from "node:crypto";
import { hashPassword, hmac, safeEqual } from "./crypto";
import type { Db } from "./db";
import { type Mailer, sendEmail } from "./email";
import { AuthError, checkPassword, normalizeEmail } from "./users";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const secret = () => process.env.AUTH_SECRET ?? "dev-only-secret";
const otpHash = (email: string, otp: string) =>
  hmac(secret(), `${email}:${otp}`);

/**
 * Emails a 6-digit code if the account exists. Always resolves the same way so
 * the endpoint cannot be used to discover which emails are registered.
 */
export async function requestReset(
  db: Db,
  emailRaw: string,
  mailer: Mailer = sendEmail
) {
  const email = normalizeEmail(emailRaw);
  const user = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (!user.rows.length) return;

  const recent = await db.query<{ sent_at: string }>(
    "SELECT sent_at FROM password_resets WHERE email = $1",
    [email]
  );
  if (
    recent.rows[0] &&
    Date.now() - Number(recent.rows[0].sent_at) < RESEND_AFTER_MS
  )
    return;

  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.query(
    `INSERT INTO password_resets (email, otp_hash, expires_at, sent_at, attempts)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (email) DO UPDATE SET otp_hash = EXCLUDED.otp_hash,
       expires_at = EXCLUDED.expires_at, sent_at = EXCLUDED.sent_at, attempts = 0`,
    [email, otpHash(email, otp), Date.now() + OTP_TTL_MS, Date.now()]
  );
  await mailer({
    to: email,
    subject: "Your Skola password reset code",
    text: `Your code is ${otp}. It expires in 10 minutes. If you did not ask for this, ignore this email.`,
  });
}

/** Checks the code, sets the new password, and signs the user out everywhere. */
export async function confirmReset(
  db: Db,
  emailRaw: string,
  otp: string,
  newPassword: string
) {
  const email = normalizeEmail(emailRaw);
  checkPassword(newPassword);
  const bad = new AuthError("invalid", "Invalid or expired code");

  // Failures return instead of throwing inside the transaction: a throw would roll back
  // the attempt counter (and the cleanup), which would disable the 5-try limit.
  const ok = await db.transaction(async (q) => {
    const { rows } = await q<{
      otp_hash: string;
      expires_at: string;
      attempts: number;
    }>(
      "SELECT otp_hash, expires_at, attempts FROM password_resets WHERE email = $1 FOR UPDATE",
      [email]
    );
    const r = rows[0];
    if (!r) return false;
    if (Number(r.expires_at) < Date.now() || r.attempts >= MAX_ATTEMPTS) {
      await q("DELETE FROM password_resets WHERE email = $1", [email]);
      return false;
    }
    if (!safeEqual(r.otp_hash, otpHash(email, String(otp).trim()))) {
      await q(
        "UPDATE password_resets SET attempts = attempts + 1 WHERE email = $1",
        [email]
      );
      return false;
    }
    const hash = await hashPassword(newPassword);
    const u = await q<{ id: string }>(
      "UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = 0 WHERE email = $1 RETURNING id",
      [email, hash]
    );
    await q("DELETE FROM password_resets WHERE email = $1", [email]);
    if (u.rows[0])
      await q(
        "UPDATE oauth_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        [u.rows[0].id, Date.now()]
      );
    return true;
  });
  if (!ok) throw bad;
}
