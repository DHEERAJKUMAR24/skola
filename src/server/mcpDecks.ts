import { randomUUID } from "node:crypto";
import { validateDeckName } from "../logic/deck/deckPath";
import {
  type Ctx,
  DEFAULT_PRESET_ID,
  type Row,
  load,
  putRows,
} from "./mcpData";
import { ManageError } from "./mcpErrors";

/** "A::B" or "A / B" to ["A", "B"]; an empty segment is an error. */
export function splitDeckPath(input: string): string[] {
  const parts = input.split(/::| \/ /).map((s) => s.trim());
  if (parts.some((s) => !s))
    throw new ManageError(
      "invalid_argument",
      `deck path "${input}" has an empty part`
    );
  return parts;
}

/** Names of the deck's ancestors and the deck itself, joined with "::". */
export function deckPathOf(decks: Row[], deck: Row): string {
  const byId = new Map(decks.map((d) => [d.id, d]));
  return [...(deck.superDecks ?? []), deck.id]
    .map((id) => byId.get(id)?.name ?? "?")
    .join("::");
}

const parentOf = (d: Row): string | undefined => (d.superDecks ?? []).at(-1);

/** A sibling under `parentId` already has this name (case-insensitive); `exceptId` is the deck being renamed. */
export const siblingTaken = (
  decks: Row[],
  parentId: string | undefined,
  name: string,
  exceptId?: string
) =>
  decks.some(
    (d) =>
      d.id !== exceptId &&
      parentOf(d) === parentId &&
      d.name.trim().toLowerCase() === name.toLowerCase()
  );

/**
 * A deck by id or by path ("Med::Cardiology", case-insensitive). With `createMissing`, the
 * levels that do not exist yet are created (and returned in `created`).
 */
export async function resolveDeckPath(
  ctx: Ctx,
  input: string,
  opts: { createMissing?: boolean } = {}
): Promise<{ deck: Row; created: Row[] }> {
  const decks = await load(ctx.db, ctx.userId, "decks");
  const byId = decks.find((d) => d.id === input);
  if (byId) return { deck: byId, created: [] };

  const segs = splitDeckPath(input);
  let cur: Row | undefined;
  let i = 0;
  for (; i < segs.length; i++) {
    const want = segs[i].toLowerCase();
    const hits = decks.filter(
      (d) => parentOf(d) === cur?.id && d.name.trim().toLowerCase() === want
    );
    if (hits.length > 1)
      throw new ManageError(
        "deck_ambiguous",
        `"${segs.slice(0, i + 1).join("::")}" matches several decks: ${hits.map((d) => d.id).join(", ")}. Use a deck id.`
      );
    if (!hits.length) break;
    cur = hits[0];
  }
  if (i === segs.length && cur) return { deck: cur, created: [] };
  if (!opts.createMissing)
    throw new ManageError(
      "deck_not_found",
      `no deck at "${segs.slice(0, i + 1).join("::")}"`
    );

  // Staged by id so a parent touched twice is written once.
  const staged = new Map<string, Row>();
  const created: Row[] = [];
  for (; i < segs.length; i++) {
    const name = segs[i];
    const bad = validateDeckName(name);
    if (bad) throw new ManageError("invalid_argument", bad);
    const id = randomUUID();
    const row: Row = {
      id,
      name,
      cards: [],
      notes: [],
      subDecks: [],
      superDecks: cur ? [...(cur.superDecks ?? []), cur.id] : [],
      options: {
        newToReviewRatio: 0.5,
        dailyNewCards: 25,
        presetId: cur?.options?.presetId ?? DEFAULT_PRESET_ID,
      },
    };
    if (cur) {
      const parent = { ...cur, subDecks: [...(cur.subDecks ?? []), id] };
      staged.set(cur.id, parent);
      const k = created.findIndex((c) => c.id === cur?.id);
      if (k >= 0) created[k] = parent;
    }
    staged.set(id, row);
    created.push(row);
    cur = row;
  }
  await putRows(
    ctx,
    [...staged.values()].map((data) => ({ tbl: "decks", id: data.id, data }))
  );
  return { deck: created.at(-1) as Row, created };
}
