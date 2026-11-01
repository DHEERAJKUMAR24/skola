import { currentUserId } from "@/server/auth";
import { getDb } from "@/server/db";
import {
  type AuthorizeRequest,
  OAuthError,
  createAuthCode,
  origin,
  validateAuthorize,
} from "@/server/oauth";

export const dynamic = "force-dynamic";

function back(
  redirectUri: string,
  o: string,
  state: string | null,
  params: Record<string, string>
) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", o); // RFC 9207
  return Response.redirect(u.toString(), 302);
}

function fail(e: unknown, p: URLSearchParams, o: string) {
  if (!(e instanceof OAuthError)) {
    console.error(e);
    return new Response("Server error", { status: 500 });
  }
  // Untrusted client or redirect_uri: show the error, never redirect to it.
  if (!e.redirectable)
    return new Response(`${e.error}: ${e.description}`, { status: 400 });
  return back(p.get("redirect_uri") as string, o, p.get("state"), {
    error: e.error,
    error_description: e.description,
  });
}

export async function GET(req: Request) {
  const o = origin(req);
  const url = new URL(req.url);
  const db = getDb();
  let r: AuthorizeRequest;
  try {
    r = await validateAuthorize(db, o, url.searchParams);
  } catch (e) {
    return fail(e, url.searchParams, o);
  }

  const userId = await currentUserId();
  if (!userId) {
    const next = encodeURIComponent(`${url.pathname}${url.search}`);
    return Response.redirect(`${o}/login?callbackUrl=${next}`, 302);
  }
  // Only our own app skips the consent screen.
  if (!r.client.firstParty)
    return Response.redirect(`${o}/oauth/consent${url.search}`, 302);

  return back(r.redirectUri, o, r.state, {
    code: await createAuthCode(db, r, userId),
  });
}

/** Consent form submit. Rechecks everything, since the form fields are user-controlled. */
export async function POST(req: Request) {
  const o = origin(req);
  if (req.headers.get("origin") !== o)
    return new Response("Bad origin", { status: 403 });
  const form = await req.formData();
  const p = new URLSearchParams();
  for (const [k, v] of form.entries())
    if (typeof v === "string" && k !== "decision") p.set(k, v);

  const db = getDb();
  let r: AuthorizeRequest;
  try {
    r = await validateAuthorize(db, o, p);
  } catch (e) {
    return fail(e, p, o);
  }
  const userId = await currentUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });
  if (form.get("decision") !== "allow")
    return back(r.redirectUri, o, r.state, { error: "access_denied" });
  return back(r.redirectUri, o, r.state, {
    code: await createAuthCode(db, r, userId),
  });
}
