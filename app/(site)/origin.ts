import { headers } from "next/headers";

/** Public base URL for server-rendered pages: APP_URL if set, else the request's own host. */
export async function siteOrigin() {
  const fixed = process.env.APP_URL?.replace(/\/$/, "");
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
