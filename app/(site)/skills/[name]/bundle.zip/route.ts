import { getDb } from "@/server/db";
import { effectiveFiles } from "@/server/skills";
import { zip } from "@/server/zip";

export const dynamic = "force-dynamic";

/** The skill folder as a zip (skola/SKILL.md, skola/references/...), the layout skill uploads expect. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const files = (await effectiveFiles(getDb(), null)).filter(
    (f) => f.skill === name
  );
  if (!files.length) return new Response("Not found", { status: 404 });
  const body = zip(
    files.map((f) => ({ path: `${name}/${f.path}`, content: f.content }))
  );
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}.zip"`,
      "cache-control":
        "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
