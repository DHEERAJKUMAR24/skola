import { useEffect, useState } from "react";

// Same-origin API (the OAuth resource for this app).
export const syncUrl: string | undefined = "/api";

const CLIENT_ID = "skola-web";
const TOKENS_KEY = "auth.tokens";
const EMAIL_KEY = "auth.email";
const PKCE_KEY = "auth.pkce";
const EVENT = "auth-changed";

interface Tokens {
  access: string;
  refresh: string;
  expiresAt: number;
}

// shortcut: tokens live in localStorage; fine for a personal app, move to httpOnly cookies if XSS surface grows.
function readTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "null");
  } catch {
    return null;
  }
}

const changed = () => window.dispatchEvent(new Event(EVENT));
export const isSignedIn = () => !!readTokens();
export const getEmail = () => localStorage.getItem(EMAIL_KEY);

/** Access token for a request that cannot wait (page hide); null if missing or expired. */
export function getAccessTokenSync() {
  const t = readTokens();
  return t && t.expiresAt > Date.now() ? t.access : null;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Starts the OAuth authorization-code flow with PKCE; the server shows its own login page if needed. */
export async function startLogin(mode: "login" | "signup" = "login") {
  const verifier = random(32);
  const challenge = b64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    )
  );
  const state = random(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const authorize = `/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: `${location.origin}/oauth/callback`,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })}`;
  location.href =
    mode === "signup"
      ? `/signup?callbackUrl=${encodeURIComponent(authorize)}`
      : authorize;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  return res;
}

function store(json: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}) {
  const t: Tokens = {
    access: json.access_token,
    refresh: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
  return t;
}

/** Called by /oauth/callback: trades the code for tokens. Throws a readable message on failure. */
export async function completeLogin(params: URLSearchParams) {
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? "null");
  sessionStorage.removeItem(PKCE_KEY);
  if (params.get("error"))
    throw new Error(
      params.get("error_description") ?? params.get("error") ?? "Sign-in failed"
    );
  const code = params.get("code");
  if (!saved || !code || params.get("state") !== saved.state)
    throw new Error("Sign-in expired, please try again");

  const res = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${location.origin}/oauth/callback`,
    code_verifier: saved.verifier,
  });
  if (!res.ok) throw new Error("Sign-in failed, please try again");
  const t = store(await res.json());
  try {
    const me = await fetch("/api/me", {
      headers: { authorization: `Bearer ${t.access}` },
    });
    if (me.ok) localStorage.setItem(EMAIL_KEY, (await me.json()).email ?? "");
  } catch {}
  changed();
}

let refreshing: Promise<Tokens | null> | null = null;

/** One refresh at a time. A rejected refresh token ends the session; a network error does not. */
function refresh() {
  refreshing ??= (async () => {
    try {
      const t = readTokens();
      if (!t) return null;
      const res = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: t.refresh,
      });
      if (!res.ok) {
        clearSession();
        return null;
      }
      return store(await res.json());
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export class NotSignedIn extends Error {}

/** fetch with a bearer token; refreshes when expired or on 401, and retries once. */
export async function authFetch(url: string, init: RequestInit = {}) {
  let t = readTokens();
  if (t && t.expiresAt - 60_000 < Date.now()) t = await refresh();
  if (!t) throw new NotSignedIn();
  const call = (tok: string) =>
    fetch(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${tok}` },
    });
  let res = await call(t.access);
  if (res.status === 401) {
    t = await refresh();
    if (!t) throw new NotSignedIn();
    res = await call(t.access);
  }
  return res;
}

/** Forgets the tokens on this device only. */
export function clearSession() {
  localStorage.removeItem(TOKENS_KEY);
  localStorage.removeItem(EMAIL_KEY);
  changed();
}

/** Revokes the refresh token on the server, ends the login cookie, and clears this device. */
export async function signOut() {
  const t = readTokens();
  clearSession();
  try {
    if (t)
      await fetch("/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: t.refresh }),
      });
    const { signOut: endCookie } = await import("next-auth/react");
    await endCookie({ redirect: false });
  } catch {}
}

/** Re-renders when the user signs in or out. */
export function useAuthEmail() {
  const read = () => (isSignedIn() ? getEmail() || "your account" : null);
  const [email, setEmail] = useState<string | null>(read);
  useEffect(() => {
    const update = () => setEmail(read());
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return email;
}
