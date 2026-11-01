import { getDb } from "@/server/db";
import { audiences, authenticate, origin, unauthorized } from "@/server/oauth";
import { pullRows } from "@/server/sync";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const o = origin(req);
  const db = getDb();
  const who = await authenticate(db, req, audiences(o).api);
  if (!who || who.scope !== "sync") return unauthorized(o);
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  if (!Number.isInteger(since) || since < 0)
    return Response.json({ error: "bad since" }, { status: 400 });
  return Response.json(await pullRows(db, who.userId, since));
}
