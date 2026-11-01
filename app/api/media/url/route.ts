import { presignRead } from "@/server/media";
import { withUser } from "@/server/mediaHttp";

export const dynamic = "force-dynamic";

/** A short-lived link to one of the signed-in user's own pictures. */
export async function GET(req: Request) {
  const sha = new URL(req.url).searchParams.get("sha");
  return withUser(req, (userId, db) => presignRead(db, userId, sha));
}
