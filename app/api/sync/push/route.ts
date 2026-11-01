import { getDb } from "@/server/db";
import { audiences, authenticate, origin, unauthorized } from "@/server/oauth";
import { pushRows, validateRows } from "@/server/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const o = origin(req);
  const db = getDb();
  const who = await authenticate(db, req, audiences(o).api);
  if (!who || who.scope !== "sync") return unauthorized(o);
  const body = await req.json().catch(() => null);
  const rows = validateRows(body?.rows);
  if (!rows) return Response.json({ error: "bad rows" }, { status: 400 });
  return Response.json(await pushRows(db, who.userId, rows));
}
