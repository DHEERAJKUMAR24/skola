import {
  BUDGET_MS,
  DEFAULT_THRESHOLD,
  type DupGroup,
  type DupItem,
  MIN_THRESHOLD,
  findDuplicateGroups,
  sidesOfContent,
} from "../logic/duplicates/similarity";
import { type Row, type Tool, ms, num, snapshot, str } from "./mcpData";

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}...` : s);

const find_similar_cards: Tool = {
  name: "find_similar_cards",
  description: `Groups of notes that say the same thing in different words (no AI or paid service: normalised words, stems, word overlap and character trigrams, with the question side and the answer side compared separately; cloze, multiple choice and list notes are read by their own parts, reverse notes are compared both ways). Read-only: it never changes or deletes anything. Use find_duplicates for exact copies.
Score 0 to 1 per group (mean of the linked pairs; min_score is the weakest link). Guide: 0.90+ trivial rewording; 0.75 to 0.90 same fact in other words; 0.5 to 0.7 related, review before acting. The default threshold is ${DEFAULT_THRESHOLD}, the lowest allowed is ${MIN_THRESHOLD}. Same question with a different answer scores low on purpose (a possible conflict, not a duplicate).
Each group names a suggested keeper (most reviews, then oldest) and a suggestion: delete_duplicates (the others add nothing) or merge_then_delete (missing_from_keep lists answer terms to fold into the keeper with edit_card first). Deleting is separate: call delete_cards with the note's card ids and the confirm token, after the user agrees.
Optional deck_id (with sub-decks), threshold, same_deck_only (default false), offset and limit (groups per page, default 20, max 50). A large collection is capped (5000 notes, about ${BUDGET_MS / 1000} seconds); then truncated is true: narrow with deck_id and run again.`,
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      threshold: { type: "number", minimum: MIN_THRESHOLD, maximum: 1 },
      same_deck_only: { type: "boolean" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
  async run(ctx, a) {
    const { decks, cards, notes } = await snapshot(ctx, str(a, "deck_id"));
    const byDeck = new Map(decks.map((d) => [d.id, d]));
    const pathOf = (id: string) => {
      const d = byDeck.get(id);
      if (!d) return "?";
      return [...(d.superDecks ?? []), d.id]
        .map((x) => byDeck.get(x)?.name ?? "?")
        .join(" / ");
    };
    const cardsOf = new Map<string, Row[]>();
    for (const c of cards)
      cardsOf.set(c.note, [...(cardsOf.get(c.note) ?? []), c]);

    const info = new Map<string, Row & { q: string; ans: string }>();
    const items: DupItem[] = [];
    for (const [noteId, cs] of cardsOf) {
      const n = notes.get(noteId);
      const sides = n && sidesOfContent(n.content ?? {});
      if (!n || !sides) continue;
      info.set(noteId, { ...n, q: sides.question, ans: sides.answer });
      items.push({
        id: noteId,
        sides,
        weight: cs.reduce((t, c) => t + (c.model?.reps ?? 0), 0),
        created: ms(n.creationDate),
      });
    }

    const rawThreshold = Number(a.threshold);
    const threshold = Number.isFinite(rawThreshold)
      ? rawThreshold
      : DEFAULT_THRESHOLD;
    const deadline = Date.now() + BUDGET_MS;
    const partitions = a.same_deck_only
      ? [...Map.groupBy(items, (i) => info.get(i.id)?.deck as string).values()]
      : [items];
    let groups: DupGroup[] = [];
    let truncated = false;
    let reason: string | undefined;
    let searched = 0;
    for (const part of partitions) {
      const left = deadline - Date.now();
      if (left <= 0) {
        truncated = true;
        reason = "time";
        break;
      }
      const r = findDuplicateGroups(part, { threshold, budgetMs: left });
      groups = groups.concat(r.groups);
      searched += r.items_searched;
      if (r.truncated) {
        truncated = true;
        reason = r.reason;
      }
    }
    groups.sort((x, y) => y.score - x.score || x.keep.localeCompare(y.keep));

    const offset = Math.max(0, Math.floor(Number(a.offset)) || 0);
    const limit = num(a, "limit", 20, 50);
    const page = groups.slice(offset, offset + limit);
    return {
      threshold: Math.max(MIN_THRESHOLD, Math.min(1, threshold)),
      total_groups: groups.length,
      offset,
      next_offset: offset + limit < groups.length ? offset + limit : null,
      truncated,
      ...(reason ? { truncated_reason: reason } : {}),
      notes_searched: searched,
      groups: page.map((g) => ({
        score: g.score,
        min_score: g.min_score,
        suggestion: g.suggestion,
        keep_note_id: g.keep,
        missing_from_keep: g.missing_from_keep,
        notes: g.ids.map((id) => {
          const n = info.get(id) as Row;
          const cs = cardsOf.get(id) ?? [];
          return {
            note_id: id,
            role: id === g.keep ? "keep" : "duplicate",
            card_ids: cs.map((c) => c.id),
            deck_id: n.deck,
            deck_path: pathOf(n.deck),
            type: n.content?.type,
            question: clip(n.q),
            answer: clip(n.ans),
            reviews: cs.reduce((t, c) => t + (c.model?.reps ?? 0), 0),
            tags: n.tags ?? [],
          };
        }),
      })),
    };
  },
};

export const DUPLICATE_TOOLS: Tool[] = [find_similar_cards];
