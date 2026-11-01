import { getDb } from "@/server/db";
import { origin } from "@/server/oauth";
import { productText } from "@/server/skillText";
import { listSkills } from "@/server/skills";

export const dynamic = "force-dynamic";

const headers = {
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  "access-control-allow-origin": "*",
};

export async function GET(req: Request) {
  const skills = (await listSkills(getDb(), null)).map((s) => s.name);
  return new Response(productText(origin(req), skills), { headers });
}
