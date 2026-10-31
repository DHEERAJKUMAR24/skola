import type { Db } from "./db";

export interface PushRow {
  tbl: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted?: boolean;
}

const TABLES = new Set(["decks", "cards", "notes", "reviewLogs"]);
export const PULL_LIMIT = 500;

export function validateRows(rows: unknown): PushRow[] | null {
  if (!Array.isArray(rows)) return null;
  for (const r of rows) {
    if (
      !r ||
      !TABLES.has(r.tbl) ||
      typeof r.id !== "string" ||
      !Number.isFinite(r.updatedAt)
    )
      return null;
  }
  return rows as PushRow[];
}

/** Applies rows that are strictly newer than stored ones; returns the user's latest seq. */
export async function pushRows(db: Db, userId: string, rows: PushRow[]) {
  return db.transaction(async (q) => {
    // Serialises pushes per user so seq order matches commit order; otherwise a puller could skip a row.
    await q("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);
    for (const r of rows) {
      await q(
        `INSERT INTO changes (user_id, tbl, id, data, updated_at, deleted, seq)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6,
           (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = $1))
         ON CONFLICT (user_id, tbl, id) DO UPDATE SET
           data = EXCLUDED.data, updated_at = EXCLUDED.updated_at,
           deleted = EXCLUDED.deleted, seq = EXCLUDED.seq
         WHERE EXCLUDED.updated_at > changes.updated_at`,
        [
          userId,
          r.tbl,
          r.id,
          JSON.stringify(r.data ?? null),
          r.updatedAt,
          !!r.deleted,
        ]
      );
    }
    const max = await q<{ seq: string }>(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE user_id = $1",
      [userId]
    );
    return { seq: Number(max.rows[0].seq) };
  });
}

export async function pullRows(db: Db, userId: string, since: number) {
  const { rows } = await db.query<{
    tbl: string;
    id: string;
    data: unknown;
    updated_at: string;
    deleted: boolean;
    seq: string;
  }>(
    `SELECT tbl, id, data, updated_at, deleted, seq FROM changes
     WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [userId, since, PULL_LIMIT]
  );
  const out = rows.map((r) => ({
    tbl: r.tbl,
    id: r.id,
    data: r.data,
    updatedAt: Number(r.updated_at),
    deleted: r.deleted,
    seq: Number(r.seq),
  }));
  return {
    rows: out,
    seq: out.length ? out[out.length - 1].seq : since,
    more: out.length === PULL_LIMIT,
  };
}
