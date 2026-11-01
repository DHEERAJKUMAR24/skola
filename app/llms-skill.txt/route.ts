import { getDb } from "@/server/db";
import { origin } from "@/server/oauth";
import { skillText } from "@/server/skillText";

export const dynamic = "force-dynamic";

const headers = {
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  "access-control-allow-origin": "*",
};

export async function GET(req: Request) {
  return new Response(await skillText(getDb(), origin(req)), { headers });
}
