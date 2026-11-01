import { getDb } from "@/server/db";
import { effectiveFiles, etagOf } from "@/server/skills";

export const dynamic = "force-dynamic";

/** One file of a default skill as plain text. Edits go live within about half a minute. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string; path: string[] }> }
) {
  const { name, path } = await ctx.params;
  const want = path.map(decodeURIComponent).join("/");
  const file = (await effectiveFiles(getDb(), null)).find(
    (f) => f.skill === name && f.path === want
  );
  if (!file) return new Response("Not found", { status: 404 });

  const etag = etagOf(file.content);
  const headers = {
    etag,
    "content-type": want.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "text/markdown; charset=utf-8",
    "cache-control":
      "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
    "access-control-allow-origin": "*",
  };
  if (req.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(file.content, { headers });
}
