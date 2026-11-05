import { connectGuide, mcpUrl } from "@/server/connectGuide";
import { getDb } from "@/server/db";
import { origin } from "@/server/oauth";
import { productText } from "@/server/skillText";
import { effectiveFiles, listSkills } from "@/server/skills";

export const dynamic = "force-dynamic";

/**
 * What the in-app Connect and Skills pages show: the connect guide, the default skills, and with
 * ?name= one skill with its files. Public on purpose, like /llms.txt: it holds the shared defaults
 * only, never a user's own skills.
 */
export async function GET(req: Request) {
  const o = origin(req);
  const db = getDb();
  const [files, summaries] = await Promise.all([
    effectiveFiles(db, null),
    listSkills(db, null),
  ]);
  const names = [...new Set(files.map((f) => f.skill))];
  const name = new URL(req.url).searchParams.get("name");

  if (name) {
    const mine = files.filter((f) => f.skill === name);
    if (!mine.length)
      return Response.json({ error: "No such skill" }, { status: 404 });
    return Response.json({
      origin: o,
      mcp: mcpUrl(o),
      name,
      files: mine.map((f) => ({ path: f.path, content: f.content })),
    });
  }

  return Response.json({
    origin: o,
    mcp: mcpUrl(o),
    agentText: productText(o, names),
    sections: connectGuide(o, names),
    skills: names.map((n) => ({
      name: n,
      description: summaries.find((s) => s.name === n)?.description ?? "",
      files: files.filter((f) => f.skill === n).map((f) => f.path),
    })),
  });
}
