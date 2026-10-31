import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { pullRows } from "@/server/sync";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  if (!Number.isInteger(since) || since < 0)
    return Response.json({ error: "bad since" }, { status: 400 });
  return Response.json(await pullRows(getDb(), session.user.id, since));
}
