import { MAX_MEDIA_BYTES, mediaEnabled } from "@/server/media";
import { withUser } from "@/server/mediaHttp";

export const dynamic = "force-dynamic";

/** Whether picture storage is set up, so the app knows to keep pictures inside notes if not. */
export async function GET(req: Request) {
  return withUser(req, async () => ({
    enabled: mediaEnabled(),
    maxBytes: MAX_MEDIA_BYTES,
  }));
}
