import { createHash, randomUUID } from "node:crypto";
import { CORS } from "./cors";
import { randomToken, safeEqual, sha256 } from "./crypto";
import type { Db } from "./db";

export const FIRST_PARTY_CLIENT = "skola-web";
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const MAX_CLIENTS = 500;

/** Public base URL. Set APP_URL in production so audiences never depend on request headers. */
export function origin(req?: Request) {
  const fixed = process.env.APP_URL?.replace(/\/$/, "");
  return fixed ?? (req ? new URL(req.url).origin : "http://localhost:3000");
}

/** Resources a token can be bound to. The token's `aud` is exactly one of these. */
export const audiences = (o: string) => ({ api: `${o}/api`, mcp: `${o}/mcp` });
const SCOPE_FOR: (o: string) => Record<string, string> = (o) => ({
  [audiences(o).api]: "sync",
  [audiences(o).mcp]: "mcp",
});

export class OAuthError extends Error {
  constructor(
    public error: string,
    public description: string,
    public status = 400,
    /** false when redirect_uri/client are untrusted, so the error must not be redirected. */
    public redirectable = true
  ) {
    super(description);
  }
}

export interface Client {
  clientId: string;
  name: string;
  redirectUris: string[];
  firstParty: boolean;
}

export async function getClient(
  db: Db,
  o: string,
  clientId: string
): Promise<Client | null> {
  if (clientId === FIRST_PARTY_CLIENT)
    return {
      clientId,
      name: "Skola++",
      redirectUris: [`${o}/oauth/callback`],
      firstParty: true,
    };
  const { rows } = await db.query<{
    client_id: string;
    name: string;
    redirect_uris: string[];
  }>(
    "SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = $1",
    [clientId]
  );
  const r = rows[0];
  return r
    ? {
        clientId: r.client_id,
        name: r.name,
        redirectUris: r.redirect_uris,
        firstParty: false,
      }
    : null;
}

const isLoopback = (h: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(h);

/** RFC 7591 dynamic registration, public clients only (no secret, PKCE required). */
export async function registerClient(db: Db, body: unknown) {
  const b = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10)
    throw new OAuthError(
      "invalid_redirect_uri",
      "redirect_uris must be 1-10 URLs"
    );
  for (const u of uris) {
    let url: URL;
    try {
      url = new URL(String(u));
    } catch {
      throw new OAuthError(
        "invalid_redirect_uri",
        "redirect_uris must be absolute URLs"
      );
    }
    const ok =
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopback(url.hostname));
    if (!ok || url.hash)
      throw new OAuthError(
        "invalid_redirect_uri",
        "Use https (or http on localhost) and no fragment"
      );
  }
  const count = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM oauth_clients"
  );
  if (count.rows[0].n >= MAX_CLIENTS)
    throw new OAuthError("temporarily_unavailable", "Too many clients", 503);

  const clientId = `c_${randomUUID()}`;
  const name = String(b.client_name ?? "Unnamed app").slice(0, 100);
  await db.query(
    "INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES ($1, $2, $3, $4)",
    [clientId, name, uris.map(String), Date.now()]
  );
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

export interface AuthorizeRequest {
  client: Client;
  redirectUri: string;
  challenge: string;
  aud: string;
  scope: string;
  state: string | null;
}

export async function validateAuthorize(
  db: Db,
  o: string,
  p: URLSearchParams
): Promise<AuthorizeRequest> {
  const client = await getClient(db, o, p.get("client_id") ?? "");
  if (!client)
    throw new OAuthError("invalid_client", "Unknown client_id", 400, false);
  const redirectUri = p.get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri))
    throw new OAuthError(
      "invalid_request",
      "redirect_uri does not match a registered URI",
      400,
      false
    );

  if (p.get("response_type") !== "code")
    throw new OAuthError(
      "unsupported_response_type",
      "Only response_type=code"
    );
  const challenge = p.get("code_challenge") ?? "";
  if (
    p.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  )
    throw new OAuthError(
      "invalid_request",
      "PKCE with code_challenge_method=S256 is required"
    );

  const known = audiences(o);
  const resource = p.get("resource");
  // Third-party clients (e.g. MCP) must say which resource the token is for (RFC 8707).
  const aud = resource ?? (client.firstParty ? known.api : "");
  if (aud !== known.api && aud !== known.mcp)
    throw new OAuthError("invalid_target", "Unknown or missing resource");
  if (client.firstParty && aud !== known.api)
    throw new OAuthError("invalid_target", "Not allowed for this client");

  return {
    client,
    redirectUri,
    challenge,
    aud,
    scope: SCOPE_FOR(o)[aud],
    state: p.get("state"),
  };
}

export async function createAuthCode(
  db: Db,
  r: AuthorizeRequest,
  userId: string
) {
  const code = randomToken("sk_ac");
  await db.query(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, aud, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sha256(code),
      r.client.clientId,
      userId,
      r.redirectUri,
      r.challenge,
      r.aud,
      r.scope,
      Date.now() + CODE_TTL_MS,
    ]
  );
  return code;
}

const pkceMatches = (verifier: string, challenge: string) =>
  /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) &&
  safeEqual(
    createHash("sha256").update(verifier).digest("base64url"),
    challenge
  );

async function issueTokens(
  db: Db,
  t: { clientId: string; userId: string; aud: string; scope: string }
) {
  const access = randomToken("sk_at");
  const refresh = randomToken("sk_rt");
  await db.query(
    `INSERT INTO oauth_tokens (id, client_id, user_id, aud, scope, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      t.clientId,
      t.userId,
      t.aud,
      t.scope,
      sha256(access),
      Date.now() + ACCESS_TTL_S * 1000,
      sha256(refresh),
      Date.now() + REFRESH_TTL_MS,
    ]
  );
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope: t.scope,
  };
}

export async function exchangeCode(
  db: Db,
  p: {
    code: string;
    redirectUri: string;
    clientId: string;
    verifier: string;
    resource: string | null;
  }
) {
  // Delete first: a code works once, even if a later check fails.
  const { rows } = await db.query<{
    client_id: string;
    user_id: string;
    redirect_uri: string;
    code_challenge: string;
    aud: string;
    scope: string;
    expires_at: string;
  }>("DELETE FROM oauth_codes WHERE code_hash = $1 RETURNING *", [
    sha256(p.code),
  ]);
  const c = rows[0];
  const bad = new OAuthError("invalid_grant", "Invalid or expired code");
  if (!c || Number(c.expires_at) < Date.now()) throw bad;
  if (c.client_id !== p.clientId || c.redirect_uri !== p.redirectUri) throw bad;
  if (!pkceMatches(p.verifier, c.code_challenge)) throw bad;
  if (p.resource && p.resource !== c.aud)
    throw new OAuthError(
      "invalid_target",
      "resource does not match the authorization"
    );
  return issueTokens(db, {
    clientId: c.client_id,
    userId: c.user_id,
    aud: c.aud,
    scope: c.scope,
  });
}

export async function refreshTokens(
  db: Db,
  p: { refreshToken: string; clientId: string }
) {
  const h = sha256(p.refreshToken);
  const bad = new OAuthError("invalid_grant", "Invalid refresh token");
  // Returns null instead of throwing inside the transaction, so the revocation below is committed.
  const result = await db.transaction(async (q) => {
    const { rows } = await q<{
      id: string;
      client_id: string;
      refresh_hash: string;
      prev_refresh_hash: string | null;
      refresh_expires_at: string;
      revoked_at: string | null;
      user_id: string;
      aud: string;
      scope: string;
    }>(
      "SELECT * FROM oauth_tokens WHERE refresh_hash = $1 OR prev_refresh_hash = $1 FOR UPDATE",
      [h]
    );
    const t = rows[0];
    if (!t || t.client_id !== p.clientId || t.revoked_at) return null;
    if (t.prev_refresh_hash === h) {
      // An already-rotated token came back: assume theft and kill the whole grant.
      await q("UPDATE oauth_tokens SET revoked_at = $2 WHERE id = $1", [
        t.id,
        Date.now(),
      ]);
      return null;
    }
    if (Number(t.refresh_expires_at) < Date.now()) return null;
    const access = randomToken("sk_at");
    const refresh = randomToken("sk_rt");
    await q(
      `UPDATE oauth_tokens SET access_hash = $2, access_expires_at = $3, refresh_hash = $4,
         prev_refresh_hash = $5, refresh_expires_at = $6 WHERE id = $1`,
      [
        t.id,
        sha256(access),
        Date.now() + ACCESS_TTL_S * 1000,
        sha256(refresh),
        h,
        Date.now() + REFRESH_TTL_MS,
      ]
    );
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: t.scope,
    };
  });
  if (!result) throw bad;
  return result;
}

/** RFC 7009: always succeeds, so callers cannot probe which tokens exist. */
export async function revokeToken(db: Db, token: string) {
  const h = sha256(token);
  await db.query(
    "UPDATE oauth_tokens SET revoked_at = $2 WHERE (access_hash = $1 OR refresh_hash = $1) AND revoked_at IS NULL",
    [h, Date.now()]
  );
}

export interface Identity {
  userId: string;
  clientId: string;
  scope: string;
  aud: string;
}

/** Validates an access token for one specific audience; a token for another resource is rejected. */
export async function verifyAccessToken(
  db: Db,
  token: string,
  aud: string
): Promise<Identity | null> {
  const { rows } = await db.query<{
    user_id: string;
    client_id: string;
    scope: string;
    aud: string;
  }>(
    `SELECT user_id, client_id, scope, aud FROM oauth_tokens
     WHERE access_hash = $1 AND aud = $2 AND revoked_at IS NULL AND access_expires_at > $3`,
    [sha256(token), aud, Date.now()]
  );
  const r = rows[0];
  return r
    ? { userId: r.user_id, clientId: r.client_id, scope: r.scope, aud: r.aud }
    : null;
}

export async function authenticate(db: Db, req: Request, aud: string) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
  return m ? verifyAccessToken(db, m[1], aud) : null;
}

/**
 * 401 body per RFC 9728 so clients can discover the authorization server. `resourcePath` names
 * the protected resource ("/mcp"): clients ask for the token for the resource this URL describes,
 * so the MCP endpoint must not point at the default (api) metadata or the token gets the wrong audience.
 */
export function unauthorized(o: string, resourcePath = "") {
  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        ...CORS,
        "WWW-Authenticate": `Bearer resource_metadata="${o}/.well-known/oauth-protected-resource${resourcePath}"`,
      },
    }
  );
}
