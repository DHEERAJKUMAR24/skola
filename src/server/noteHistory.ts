import { randomUUID } from "node:crypto";
import type { Query } from "./db";

/** How long old versions stay. Pruned on every edit of the same note: no cron job. */
export const HISTORY_DAYS = 7;
const DAY_MS = 86_400_000;
/** App edits arrive in bursts while someone types; one snapshot covers the burst. */
export const APP_COALESCE_MS = 5 * 60_000;

const PICTURE_OMITTED = "(inline picture not kept in history)";

type Json = Record<string, any>;

/** Inline pictures can be 400 KB: history keeps only text and picture links. */
export function slim(content: Json | undefined): Json {
  const c = { ...(content ?? {}) };
  if (typeof c.image === "string" && c.image.startsWith("data:"))
    c.image = PICTURE_OMITTED;
  return c;
}

export const pictureOmitted = (c: Json) => c.image === PICTURE_OMITTED;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Called by pushRows just before a note row is overwritten. Saves the version that is about to be
 * replaced, then drops versions older than 7 days for this note, except the one just saved, so a
 * note that was last edited a month ago still shows its previous version.
 * Never throws: history must not be able to block a sync (it also runs before the migration exists).
 */
export async function recordNoteVersion(
  q: Query,
  userId: string,
  noteId: string,
  next: Json | null | undefined,
  nextUpdatedAt: number,
  now: number,
  coalesceMs: number
) {
  try {
    await q("SAVEPOINT note_history");
    const { rows } = await q<{
      data: Json;
      updated_at: string;
      deleted: boolean;
    }>(
      "SELECT data, updated_at, deleted FROM changes WHERE user_id = $1 AND tbl = 'notes' AND id = $2",
      [userId, noteId]
    );
    const old = rows[0];
    if (
      old &&
      !old.deleted &&
      nextUpdatedAt > Number(old.updated_at) &&
      !(
        same(slim(old.data?.content), slim(next?.content)) &&
        same(old.data?.tags ?? [], next?.tags ?? [])
      )
    ) {
      const { rows: latest } = await q<{ replaced_at: string }>(
        "SELECT replaced_at FROM note_versions WHERE user_id = $1 AND note_id = $2 ORDER BY replaced_at DESC LIMIT 1",
        [userId, noteId]
      );
      const burst =
        coalesceMs > 0 &&
        latest[0] &&
        now - Number(latest[0].replaced_at) < coalesceMs;
      if (!burst) {
        const id = `ver_${randomUUID().replace(/-/g, "")}`;
        await q(
          `INSERT INTO note_versions (user_id, id, note_id, content, tags, sort_field, replaced_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
          [
            userId,
            id,
            noteId,
            JSON.stringify(slim(old.data?.content)),
            JSON.stringify(old.data?.tags ?? []),
            old.data?.sortField ?? null,
            now,
          ]
        );
        await q(
          "DELETE FROM note_versions WHERE user_id = $1 AND note_id = $2 AND replaced_at < $3 AND id <> $4",
          [userId, noteId, now - HISTORY_DAYS * DAY_MS, id]
        );
      }
    }
    await q("RELEASE SAVEPOINT note_history");
  } catch {
    try {
      await q("ROLLBACK TO SAVEPOINT note_history");
      await q("RELEASE SAVEPOINT note_history");
    } catch {
      /* connection is gone; the caller's own query will report it */
    }
  }
}
