import { OAuthError } from "./oauth";

/** Public OAuth endpoints use PKCE and no cookies, so any origin may call them. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, "cache-control": "no-store", ...headers } });

export function oauthError(e: unknown) {
  if (e instanceof OAuthError)
    return json({ error: e.error, error_description: e.description }, e.status);
  console.error(e);
  return json({ error: "server_error" }, 500);
}

/** Reads an OAuth request body, which is form-encoded (JSON accepted too). */
export async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(b).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}
