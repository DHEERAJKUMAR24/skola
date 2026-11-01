import { getDb } from "@/server/db";
import { json, oauthError, preflight, readParams } from "@/server/http";
import { OAuthError, exchangeCode, refreshTokens } from "@/server/oauth";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  try {
    const p = await readParams(req);
    const need = (k: string) => {
      const v = p.get(k);
      if (!v) throw new OAuthError("invalid_request", `Missing ${k}`);
      return v;
    };
    const db = getDb();
    const grant = p.get("grant_type");
    if (grant === "authorization_code")
      return json(
        await exchangeCode(db, {
          code: need("code"),
          redirectUri: need("redirect_uri"),
          clientId: need("client_id"),
          verifier: need("code_verifier"),
          resource: p.get("resource"),
        })
      );
    if (grant === "refresh_token")
      return json(
        await refreshTokens(db, {
          refreshToken: need("refresh_token"),
          clientId: need("client_id"),
        })
      );
    throw new OAuthError(
      "unsupported_grant_type",
      "Use authorization_code or refresh_token"
    );
  } catch (e) {
    return oauthError(e);
  }
}
