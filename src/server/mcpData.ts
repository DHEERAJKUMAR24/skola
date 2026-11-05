import type { Db } from "./db";
import { pushRows } from "./sync";

/** Rows as synced: Dates arrive tagged `{ $d: ms }` (see src/logic/sync.ts). */
export type Row = Record<string, any>;

export interface Ctx {
  db: Db;
  userId: string;
  now: number;
}

export type Args = Record<string, unknown>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  /** Tools that change data; clients may ask before running them. */
  write?: boolean;
  /** Deletes or overwrites data the user may want back. */
  destructive?: boolean;
  /** Client hints sent in tools/list as `_meta` (for example ChatGPT's `openai/fileParams`). */
  meta?: Record<string, unknown>;
  run: (ctx: Ctx, a: Args) => Promise<unknown>;
}

export const ms = (d: unknown): number =>
  d && typeof d === "object" && "$d" in d ? Number((d as Row).$d) : 0;

export const str = (a: Args, k: string) =>
  typeof a[k] === "string" ? (a[k] as string) : undefined;

export const num = (a: Args, k: string, d: number, max: number) =>
  Math.min(Math.max(Number(a[k]) || d, 1), max);

/** Same wire format as the client: Dates become `{ $d: ms }`. */
export function encode(data: unknown): unknown {
  return JSON.parse(
    JSON.stringify(data, function (this: Row, key, v) {
      const raw = this[key];
      return raw instanceof Date ? { $d: raw.getTime() } : v;
    })
  );
}

export function decode<T = Row>(data: unknown): T {
  return JSON.parse(JSON.stringify(data), (_k, v) =>
    v && typeof v === "object" && "$d" in v ? new Date(v.$d) : v
  );
}

export async function load(db: Db, userId: string, tbl: string) {
  const { rows } = await db.query<{ data: Row }>(
    "SELECT data FROM changes WHERE user_id = $1 AND tbl = $2 AND NOT deleted",
    [userId, tbl]
  );
  return rows.map((r) => r.data);
}

const strip = (v: string) => v.replace(/<[^>]*>/g, " ").trim();

export const noteFields = (n: Row): string[] => {
  const c = n.content ?? {};
  return [
    ...Object.entries(c)
      .filter(
        ([k, v]) => k !== "type" && k !== "image" && typeof v === "string"
      )
      .map(([, v]) => strip(String(v))),
    // Multiple choice and list cards keep their text in arrays.
    ...(Array.isArray(c.choices)
      ? c.choices.map((x: Row) => String(x.text ?? ""))
      : []),
    ...(Array.isArray(c.items) ? c.items.map(String) : []),
  ];
};

export const noteText = (n: Row) => noteFields(n).join(" | ");

/**
 * Labeled note fields with markup stripped: front/back, text, question, and for list and multiple
 * choice cards the arrays too (`choices`, `items`, `correct`) so a quiz can tell the sides apart.
 */
export const noteFieldMap = (n: Row): Record<string, string | string[]> => {
  const c = n.content ?? {};
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(c)) {
    if (k === "type" || k === "image" || typeof v !== "string") continue;
    out[k] = String(v)
      .replace(/<\/p>\s*<p>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .trim();
  }
  if (Array.isArray(c.choices)) {
    out.choices = c.choices.map((x: Row) => String(x.text ?? ""));
    out.correct = c.choices
      .filter((x: Row) => x.correct)
      .map((x: Row) => String(x.text ?? ""));
  }
  if (Array.isArray(c.items)) out.items = c.items.map(String);
  if (c.type === "list") out.ordered = c.ordered ? "true" : "false";
  if (c.type === "imageOcclusion") {
    if (typeof c.image === "string" && c.image.startsWith("https://"))
      out.image_url = c.image;
    else out.image = "(picture: call get_card_image with this card's id)";
    out.hide_all = c.hideAll === false ? "false" : "true";
    out.areas = (c.boxes ?? []).map(
      (b: Row) =>
        `${b.id}: x=${b.x.toFixed(2)} y=${b.y.toFixed(2)} w=${b.w.toFixed(2)} h=${b.h.toFixed(2)}`
    );
  }
  return out;
};

/** The deck and everything below it; no id means every deck. */
export function deckScope(decks: Row[], deckId?: string): Set<string> {
  return new Set(
    decks
      .filter(
        (d) =>
          !deckId || d.id === deckId || (d.superDecks ?? []).includes(deckId)
      )
      .map((d) => d.id)
  );
}

export const studyable = (c: Row, now: number) =>
  !c.suspended && !(c.buriedUntil && c.buriedUntil > now);

export async function snapshot({ db, userId }: Ctx, deckId?: string) {
  const [decks, cards, notes] = await Promise.all([
    load(db, userId, "decks"),
    load(db, userId, "cards"),
    load(db, userId, "notes"),
  ]);
  const scope = deckScope(decks, deckId);
  return {
    decks,
    notes: new Map(notes.map((n) => [n.id, n])),
    cards: cards.filter((c) => scope.has(c.deck)),
  };
}

export const cardView = (c: Row, notes: Map<string, Row>) => ({
  id: c.id,
  deck: c.deck,
  state: c.model?.state,
  due: ms(c.model?.due) || undefined,
  lapses: c.model?.lapses,
  type: c.content?.type,
  // Which cloze deletion (c1, c2, ...) or image area this card asks about.
  occlusion: c.content?.occlusionNumber,
  fields: noteFieldMap(notes.get(c.note) ?? {}),
  text: noteText(notes.get(c.note) ?? {}),
  suspended: !!c.suspended,
});

export interface WriteRow {
  tbl: string;
  id: string;
  data: Row;
  /** Review logs are keyed by `reviewedAt` on the wire, other tables by `updatedAt`. */
  at?: number;
  /** Tombstone: devices remove the row on their next pull. */
  deleted?: boolean;
}

/**
 * Writes rows the way a client push would, so every device picks them up on its next pull.
 * Each row is stamped just past the stored one, otherwise last-write-wins would drop it.
 */
export async function putRows(ctx: Ctx, rows: WriteRow[]) {
  const { rows: existing } = await ctx.db.query<{
    tbl: string;
    id: string;
    updated_at: string;
  }>(
    "SELECT tbl, id, updated_at FROM changes WHERE user_id = $1 AND id = ANY($2)",
    [ctx.userId, rows.map((r) => r.id)]
  );
  const prev = new Map(
    existing.map((r) => [`${r.tbl}/${r.id}`, +r.updated_at])
  );
  const wire = rows.map((r) => {
    const updatedAt =
      r.at ?? Math.max(ctx.now, (prev.get(`${r.tbl}/${r.id}`) ?? 0) + 1);
    const data = r.tbl === "reviewLogs" ? r.data : { ...r.data, updatedAt };
    return {
      tbl: r.tbl,
      id: r.id,
      data: encode(data),
      updatedAt,
      ...(r.deleted ? { deleted: true } : {}),
    };
  });
  // No burst merging for MCP edits: every change is its own undo step.
  const { applied } = await pushRows(ctx.db, ctx.userId, wire, {
    coalesceMs: 0,
  });
  if (applied !== wire.length) throw new Error("A concurrent write won; retry");
}
