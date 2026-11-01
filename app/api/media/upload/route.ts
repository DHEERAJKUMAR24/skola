import { requestUpload } from "@/server/media";
import { withUser } from "@/server/mediaHttp";

export const dynamic = "force-dynamic";

/** Announce a picture (sha256, size, type); get back a link to PUT it to R2, or `exists`. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) ?? {};
  return withUser(req, (userId, db) => requestUpload(db, userId, b));
}
