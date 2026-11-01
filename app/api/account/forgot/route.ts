import { getDb } from "@/server/db";
import { requestReset } from "@/server/reset";

export const dynamic = "force-dynamic";

// Same answer whether or not the email exists, so this cannot be used to find accounts.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  try {
    if (typeof b?.email === "string") await requestReset(getDb(), b.email);
  } catch (e) {
    console.error("password reset request failed", e);
  }
  return Response.json({ ok: true });
}
