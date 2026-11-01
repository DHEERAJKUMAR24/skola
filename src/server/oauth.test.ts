// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import {
  FIRST_PARTY_CLIENT,
  OAuthError,
  audiences,
  createAuthCode,
  exchangeCode,
  refreshTokens,
  registerClient,
  revokeToken,
  validateAuthorize,
  verifyAccessToken,
} from "./oauth";
import { confirmReset, requestReset } from "./reset";
import { AuthError, createUser, verifyLogin } from "./users";

const O = "https://skola.test";
const REDIRECT = `${O}/oauth/callback`;
let db: Db;

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(
    fs.readFileSync("supabase/migrations/20261101000000_init.sql", "utf8")
  );
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
});

const pkce = () => {
  const verifier = "v".repeat(50);
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
};

const authorizeParams = (
  over: Record<string, string> = {},
  challenge = pkce().challenge
) =>
  new URLSearchParams({
    response_type: "code",
    client_id: FIRST_PARTY_CLIENT,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s",
    ...over,
  });

async function login(email: string) {
  const u = await createUser(db, email, "a-long-enough-password");
  return u.id;
}

async function tokensFor(userId: string, over: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const r = await validateAuthorize(db, O, authorizeParams(over, challenge));
  const code = await createAuthCode(db, r, userId);
  return exchangeCode(db, {
    code,
    redirectUri: r.redirectUri,
    clientId: r.client.clientId,
    verifier,
    resource: null,
  });
}

describe("accounts", () => {
  it("creates users, rejects duplicates and weak passwords, locks after repeated failures", async () => {
    await createUser(db, "Dup@Example.com", "a-long-enough-password");
    await expect(
      createUser(db, "dup@example.com", "a-long-enough-password")
    ).rejects.toMatchObject({ code: "exists" });
    await expect(
      createUser(db, "x@example.com", "short")
    ).rejects.toMatchObject({ code: "weak" });

    expect(
      await verifyLogin(db, "dup@example.com", "a-long-enough-password")
    ).toMatchObject({ email: "dup@example.com" });
    expect(
      await verifyLogin(db, "nobody@example.com", "whatever-password")
    ).toBeNull();
    for (let i = 0; i < 5; i++)
      expect(
        await verifyLogin(db, "dup@example.com", "wrong-password-1")
      ).toBeNull();
    await expect(
      verifyLogin(db, "dup@example.com", "a-long-enough-password")
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("password reset with email OTP", () => {
  const sent: { to: string; text: string }[] = [];
  const mailer = async (m: { to: string; subject: string; text: string }) =>
    void sent.push(m);
  const lastOtp = () =>
    /code is (\d{6})/.exec(sent[sent.length - 1].text)?.[1] as string;

  it("sends a code only for real accounts, and the code works once", async () => {
    await login("reset@example.com");
    await requestReset(db, "ghost@example.com", mailer);
    expect(sent).toHaveLength(0);

    await requestReset(db, "reset@example.com", mailer);
    expect(sent).toHaveLength(1);
    await requestReset(db, "reset@example.com", mailer); // within 60 s: no second mail
    expect(sent).toHaveLength(1);

    const otp = lastOtp();
    await confirmReset(db, "reset@example.com", otp, "brand-new-password-1");
    expect(
      await verifyLogin(db, "reset@example.com", "brand-new-password-1")
    ).not.toBeNull();
    await expect(
      confirmReset(db, "reset@example.com", otp, "another-password-22")
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects wrong codes, stops after 5 tries, and revokes existing tokens", async () => {
    const id = await login("brute@example.com");
    const t = await tokensFor(id);
    await requestReset(db, "brute@example.com", mailer);
    const otp = lastOtp();
    for (let i = 0; i < 5; i++)
      await expect(
        confirmReset(db, "brute@example.com", "000000", "brand-new-password-1")
      ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      confirmReset(db, "brute@example.com", otp, "brand-new-password-1")
    ).rejects.toMatchObject({ code: "invalid" });

    await requestReset(db, "brute@example.com", mailer).catch(() => {});
    await db.query(
      "UPDATE password_resets SET sent_at = 0 WHERE email = 'brute@example.com'"
    );
    await requestReset(db, "brute@example.com", mailer);
    await confirmReset(
      db,
      "brute@example.com",
      lastOtp(),
      "brand-new-password-1"
    );
    expect(
      await verifyAccessToken(db, t.access_token, audiences(O).api)
    ).toBeNull();
  });
});

describe("OAuth server", () => {
  it("issues an opaque token bound to the api audience", async () => {
    const id = await login("oauth1@example.com");
    const t = await tokensFor(id);
    expect(t.access_token).toMatch(/^sk_at_/);
    expect(t.access_token.split(".")).toHaveLength(1); // not a JWT
    expect(
      await verifyAccessToken(db, t.access_token, audiences(O).api)
    ).toMatchObject({ userId: id, scope: "sync" });
    expect(
      await verifyAccessToken(db, t.access_token, audiences(O).mcp)
    ).toBeNull();
  });

  it("requires PKCE, exact redirect_uri and a known resource", async () => {
    await expect(
      validateAuthorize(
        db,
        O,
        authorizeParams({ code_challenge_method: "plain" })
      )
    ).rejects.toMatchObject({ error: "invalid_request" });
    await expect(
      validateAuthorize(
        db,
        O,
        authorizeParams({ redirect_uri: "https://evil.test/cb" })
      )
    ).rejects.toMatchObject({ redirectable: false });
    await expect(
      validateAuthorize(db, O, authorizeParams({ client_id: "nope" }))
    ).rejects.toMatchObject({ redirectable: false });
    await expect(
      validateAuthorize(
        db,
        O,
        authorizeParams({ resource: "https://other.test/api" })
      )
    ).rejects.toMatchObject({ error: "invalid_target" });
  });

  it("codes are single use and bound to the PKCE verifier", async () => {
    const id = await login("oauth2@example.com");
    const { verifier, challenge } = pkce();
    const r = await validateAuthorize(db, O, authorizeParams({}, challenge));
    const code = await createAuthCode(db, r, id);
    const args = {
      redirectUri: REDIRECT,
      clientId: FIRST_PARTY_CLIENT,
      resource: null,
    };
    await expect(
      exchangeCode(db, { ...args, code, verifier: "x".repeat(50) })
    ).rejects.toBeInstanceOf(OAuthError);
    // the failed attempt already burned the code
    await expect(
      exchangeCode(db, { ...args, code, verifier })
    ).rejects.toMatchObject({ error: "invalid_grant" });
  });

  it("rotates refresh tokens and revokes the grant if an old one is replayed", async () => {
    const id = await login("oauth3@example.com");
    const t1 = await tokensFor(id);
    const t2 = await refreshTokens(db, {
      refreshToken: t1.refresh_token,
      clientId: FIRST_PARTY_CLIENT,
    });
    expect(
      await verifyAccessToken(db, t1.access_token, audiences(O).api)
    ).toBeNull();
    expect(
      await verifyAccessToken(db, t2.access_token, audiences(O).api)
    ).not.toBeNull();

    await expect(
      refreshTokens(db, {
        refreshToken: t1.refresh_token,
        clientId: FIRST_PARTY_CLIENT,
      })
    ).rejects.toMatchObject({ error: "invalid_grant" });
    expect(
      await verifyAccessToken(db, t2.access_token, audiences(O).api)
    ).toBeNull();
  });

  it("revokes tokens on request", async () => {
    const t = await tokensFor(await login("oauth4@example.com"));
    await revokeToken(db, t.refresh_token);
    expect(
      await verifyAccessToken(db, t.access_token, audiences(O).api)
    ).toBeNull();
    await expect(
      refreshTokens(db, {
        refreshToken: t.refresh_token,
        clientId: FIRST_PARTY_CLIENT,
      })
    ).rejects.toMatchObject({ error: "invalid_grant" });
  });

  it("registers third-party clients that must name a resource, and mcp tokens only work for the mcp audience", async () => {
    const reg = await registerClient(db, {
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    await expect(
      registerClient(db, { redirect_uris: ["http://evil.test/cb"] })
    ).rejects.toMatchObject({ error: "invalid_redirect_uri" });

    const over = {
      client_id: reg.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    };
    await expect(
      validateAuthorize(db, O, authorizeParams(over))
    ).rejects.toMatchObject({ error: "invalid_target" });

    const id = await login("oauth5@example.com");
    const t = await tokensFor(id, { ...over, resource: audiences(O).mcp });
    expect(
      await verifyAccessToken(db, t.access_token, audiences(O).mcp)
    ).toMatchObject({ userId: id, scope: "mcp" });
    expect(
      await verifyAccessToken(db, t.access_token, audiences(O).api)
    ).toBeNull();
  });
});
