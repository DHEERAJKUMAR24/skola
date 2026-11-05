import { getDb } from "@/server/db";
import { origin } from "@/server/oauth";
import { allText } from "@/server/skillText";

export const dynamic = "force-dynamic";

/** Same file as /skills/llm.txt, for agents that look for the llms.txt spelling. */
export async function GET(req: Request) {
  return new Response(await allText(getDb(), origin(req)), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control":
        "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
      "access-control-allow-origin": "*",
    },
  });
}
