import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { pushRows, validateRows } from "@/server/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const rows = validateRows(body?.rows);
  if (!rows) return Response.json({ error: "bad rows" }, { status: 400 });
  return Response.json(await pushRows(getDb(), session.user.id, rows));
}
