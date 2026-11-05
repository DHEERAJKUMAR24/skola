import { getDb } from "@/server/db";
import { origin } from "@/server/oauth";
import { allText } from "@/server/skillText";

export const dynamic = "force-dynamic";

const headers = {
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  "access-control-allow-origin": "*",
};

/** Server-rendered plain text for AI agents: the connect guide and every default skill in one file. */
export async function GET(req: Request) {
  return new Response(await allText(getDb(), origin(req)), { headers });
}
