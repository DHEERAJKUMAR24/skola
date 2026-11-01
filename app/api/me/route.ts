import { getDb } from "@/server/db";
import { audiences, authenticate, origin, unauthorized } from "@/server/oauth";
import { getUserEmail } from "@/server/users";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const o = origin(req);
  const db = getDb();
  const who = await authenticate(db, req, audiences(o).api);
  if (!who) return unauthorized(o);
  return Response.json({ email: await getUserEmail(db, who.userId) });
}
