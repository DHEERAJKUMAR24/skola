import { getDb } from "@/server/db";
import { json, preflight, readParams } from "@/server/http";
import { revokeToken } from "@/server/oauth";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const token = (await readParams(req)).get("token");
  if (token) await revokeToken(getDb(), token);
  return json({});
}
