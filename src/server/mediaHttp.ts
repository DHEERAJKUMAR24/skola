import { getDb } from "./db";
import { json } from "./http";
import { MediaError } from "./media";
import { audiences, authenticate, origin, unauthorized } from "./oauth";

/**
 * Wraps a media route: requires the same bearer token as the sync API, turns MediaError into the
 * right status, and never leaks anything else.
 */
export async function withUser(
  req: Request,
  run: (userId: string, db: ReturnType<typeof getDb>) => Promise<unknown>
) {
  const o = origin(req);
  const db = getDb();
  const who = await authenticate(db, req, audiences(o).api);
  if (!who) return unauthorized(o);
  try {
    return json(await run(who.userId, db));
  } catch (e) {
    if (e instanceof MediaError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
}
