import { useEffect, useState } from "react";

// Same-origin Next.js API routes.
export const syncUrl: string | undefined = "/api";

const TOKEN_KEY = "auth.token";
const EMAIL_KEY = "auth.email";
const EVENT = "auth-changed";

// shortcut: token lives in localStorage; fine for a personal app, move to an httpOnly cookie if XSS surface grows.
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getEmail = () => localStorage.getItem(EMAIL_KEY);

export function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
  window.dispatchEvent(new Event(EVENT));
}

async function authRequest(path: string, body: Record<string, string>) {
  if (!syncUrl) throw new Error("Sync is not configured (VITE_SYNC_URL)");
  const res = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const token = res.headers.get("set-auth-token");
  if (!res.ok || !token) throw new Error(data.message ?? `Request failed (${res.status})`);
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, body.email);
  window.dispatchEvent(new Event(EVENT));
}

export const signIn = (email: string, password: string) =>
  authRequest("sign-in/email", { email, password });

export const signUp = (email: string, password: string) =>
  authRequest("sign-up/email", { email, password, name: email.split("@")[0] });

/** Re-renders when the user signs in or out. */
export function useAuthEmail() {
  const [email, setEmail] = useState(getToken() ? getEmail() : null);
  useEffect(() => {
    const update = () => setEmail(getToken() ? getEmail() : null);
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return email;
}
