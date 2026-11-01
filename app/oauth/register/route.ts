import { getDb } from "@/server/db";
import { json, oauthError, preflight } from "@/server/http";
import { registerClient } from "@/server/oauth";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    return json(await registerClient(getDb(), body), 201);
  } catch (e) {
    return oauthError(e);
  }
}
