import { OBJECTIVE_OPS, runAppOp } from "@/server/appApi";
import { getDb } from "@/server/db";
import { audiences, authenticate, origin, unauthorized } from "@/server/oauth";

export const dynamic = "force-dynamic";

/** App backend for the objectives screens: same functions as the MCP tools, bearer token only. */
export async function POST(req: Request) {
  const o = origin(req);
  const db = getDb();
  const who = await authenticate(db, req, audiences(o).api);
  if (!who) return unauthorized(o);
  const body = await req.json().catch(() => null);
  const r = await runAppOp(db, who.userId, OBJECTIVE_OPS, body);
  return Response.json(r.body, { status: r.status });
}
