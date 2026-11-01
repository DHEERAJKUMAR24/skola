import { confirmUpload } from "@/server/media";
import { withUser } from "@/server/mediaHttp";

export const dynamic = "force-dynamic";

/** Tell the server the PUT finished; it checks R2 before accepting the picture. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) ?? {};
  return withUser(req, (userId, db) => confirmUpload(db, userId, b.sha256));
}
