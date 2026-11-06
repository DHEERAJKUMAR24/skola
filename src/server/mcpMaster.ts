// MCP tools for master cards (ADR 0014). A master is an ordinary note (content.type "master") plus
// its own study cards, so every write goes through putRows and the 7-day note history applies.
// The rules are the pure modules in src/logic/master (never Dexie): this file only loads rows,
// calls them and stages the writes. `syncPlan` is the server twin of syncMasterCards in the app.
import { createHash, randomUUID } from "node:crypto";
import { createEmptyCard, default_w } from "ts-fsrs";
import {
  type CoverageCard,
  type CoverageReport,
  analyzeCoverage,
  describeCoverage,
} from "../logic/master/coverage";
import {
  MASTER_MAX_ENTRIES,
  MASTER_MAX_SECTIONS,
  type MasterEntry,
  type MasterNoteContent,
  type MasterSection,
  cleanMaster,
  countEntries,
  linkedCardIds,
  masterSortField,
  masterToText,
  newMasterId,
  planMasterCards,
  sectionsForCard,
  validateMaster,
} from "../logic/master/masterModel";
import {
  type LinkedCardState,
  suggestMasterRating,
} from "../logic/master/suggestRating";
import { normalizeTags } from "../logic/note/tagNormalize";
import {
  HIERARCHY_KEY,
  deckLevelName,
  effectiveHierarchy,
  entryName,
  levelsWithRole,
  sectionLevelName,
} from "../logic/settings/hierarchy";
import {
  type Ctx,
  type Row,
  type Tool,
  type WriteRow,
  load,
  masterSections,
  ms,
  noteText,
  putRows,
  str,
} from "./mcpData";

export const MASTER_TYPE = "master";
const MAX_OPS = 100;
const MAX_LIST = 100;
const STATES = ["new", "learning", "review", "relearning"];

/** `[code] message` so a client can branch on the code and show the text. */
class MasterError extends Error {
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}

const CONFIRM_HINT =
  "Nothing was deleted. Show the learner what will be removed and, only if they agree, repeat this call with the confirm_token.";

const confirmToken = (ctx: Ctx, ...parts: (string | number)[]) =>
  createHash("sha256")
    .update([ctx.userId, ...parts].join("/"))
    .digest("hex")
    .slice(0, 12);

/** One id per (user, key, part), so a retry with the same key rewrites the same rows. */
function detId(userId: string, key: string, part: string) {
  const h = createHash("sha256")
    .update(`${userId}\0${key}\0${part}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

const isMasterNote = (n: Row | undefined): n is Row =>
  n?.content?.type === MASTER_TYPE;

// ---- loading --------------------------------------------------------------------------------

interface World {
  decks: Row[];
  cards: Row[];
  notes: Row[];
  settings: Row[];
}

async function world(ctx: Ctx): Promise<World> {
  const [decks, cards, notes, settings] = await Promise.all(
    ["decks", "cards", "notes", "settings"].map((t) =>
      load(ctx.db, ctx.userId, t)
    )
  );
  return { decks, cards, notes, settings };
}

const setting = (w: World, key: string) =>
  w.settings.find((s) => s.key === key)?.value;

/** The user's own names for the hierarchy levels, so replies say "Chapter" and "Concept". */
function labelsOf(w: World, deck?: Row) {
  const { levels } = effectiveHierarchy(setting(w, HIERARCHY_KEY));
  return {
    deck: deckLevelName(levels, (deck?.superDecks ?? []).length),
    master: levelsWithRole(levels, "master")[0]?.name ?? "Master card",
    section: sectionLevelName(levels, 0),
    entry: entryName(levels),
  };
}
type Labels = ReturnType<typeof labelsOf>;

const plural = (name: string, n: number) =>
  n === 1
    ? name
    : /[^aeiou]y$/i.test(name)
      ? `${name.slice(0, -1)}ies`
      : /(s|x|ch|sh)$/i.test(name)
        ? `${name}es`
        : `${name}s`;

const countText = (l: Labels, sections: number, entries: number) =>
  `${sections} ${plural(l.section, sections)}, ${entries} ${plural(l.entry, entries)}`;

function weightsOf(w: World): number[] {
  const raw = setting(w, "#globalScheduler_w");
  const list = String(raw ?? "")
    .split(",")
    .map(Number);
  return list.length === default_w.length && list.every(Number.isFinite)
    ? list
    : [...default_w];
}

const deckPath = (w: World, deckId: string) => {
  const by = new Map(w.decks.map((d) => [d.id, d]));
  const d = by.get(deckId);
  if (!d) return "?";
  return [...(d.superDecks ?? []), d.id]
    .map((id) => by.get(id)?.name ?? "?")
    .join(" / ");
};

const contentOf = (note: Row): MasterNoteContent => ({
  title: String(note.content?.title ?? ""),
  sections: masterSections(note.content ?? {}),
});

const toCoverageCard = (c: Row): CoverageCard => ({
  id: c.id,
  state: c.model?.state,
  due: ms(c.model?.due) || undefined,
  lastReview: ms(c.model?.last_review) || null,
  reps: c.model?.reps,
  suspended: !!c.suspended,
});

const toLinkedState = (c: Row): LinkedCardState => ({
  state: c.model?.state ?? 0,
  stability: c.model?.stability ?? 0,
  due: ms(c.model?.due) || undefined,
  lastReview: ms(c.model?.last_review) || null,
  lapses: c.model?.lapses ?? 0,
  reps: c.model?.reps ?? 0,
  suspended: !!c.suspended,
});

const masterNoteIds = (w: World, deckId: string) =>
  new Set(
    w.notes.filter((n) => n.deck === deckId && isMasterNote(n)).map((n) => n.id)
  );

/** Same inputs as coverageOfMaster in the app: the master's own deck, other masters' cards ignored. */
function coverageFor(
  w: World,
  note: Row,
  sections: MasterSection[],
  now: number,
  opts: { overdueDays?: number; similarity?: number } = {}
): CoverageReport {
  const deckCards = w.cards.filter((c) => c.deck === note.deck);
  const inDeck = new Set(deckCards.map((c) => c.id));
  const everything = new Set(w.cards.map((c) => c.id));
  const masters = masterNoteIds(w, note.deck);
  return analyzeCoverage(sections, deckCards.map(toCoverageCard), {
    now,
    overdueDays: opts.overdueDays,
    similarity: opts.similarity,
    ignoreCardIds: deckCards
      .filter((c) => masters.has(c.note))
      .map((c) => c.id),
    externalCardIds: linkedCardIds(sections).filter(
      (id) => !inDeck.has(id) && everything.has(id)
    ),
  });
}

const coverageSummary = (r: CoverageReport) => ({
  coverage: Math.round(r.stats.coverage * 1000) / 1000,
  complete: r.complete,
  deck_cards: r.stats.deckCards,
  covered_cards: r.stats.coveredCards,
  orphan_cards: r.orphanCards.length,
  dangling_entries: r.danglingEntries.length,
  empty_sections: r.emptySections.length,
  unlinked_entries: r.unlinkedEntries.length,
  stale_entries: r.staleEntries.length,
  duplicate_groups:
    r.duplicates.sameCard.length + r.duplicates.similarText.length,
});

/** The master a call names: master_id (the note id) or the id of one of its study cards. */
function findMaster(w: World, a: Row): Row {
  const id = str(a, "master_id") ?? str(a, "card_id");
  if (!id)
    throw new MasterError(
      "invalid_argument",
      "give master_id (from list_master_cards) or the card_id of a master card."
    );
  let note = w.notes.find((n) => n.id === id);
  if (!note) {
    const card = w.cards.find((c) => c.id === id);
    note = card && w.notes.find((n) => n.id === card.note);
  }
  if (!note)
    throw new MasterError(
      "master_not_found",
      "no master card has that id. Call list_master_cards."
    );
  if (!isMasterNote(note))
    throw new MasterError(
      "not_a_master",
      "that note is an ordinary card, not a master card. Create one with create_master_card."
    );
  return note;
}

const ownCards = (w: World, noteId: string) =>
  w.cards.filter((c) => c.note === noteId);

/** What an entry for a card is called: the note's sort text, "(2/3)" for siblings of one note. */
function entryTexts(w: World, deckCards: Row[]) {
  const notes = new Map(w.notes.map((n) => [n.id, n]));
  const per = new Map<string, Row[]>();
  for (const c of deckCards) {
    if (isMasterNote(notes.get(c.note))) continue;
    per.set(c.note, [...(per.get(c.note) ?? []), c]);
  }
  const text = new Map<string, string>();
  const order: { card: Row; note: Row }[] = [];
  const noteList = [...per.keys()]
    .map((id) => notes.get(id))
    .filter((n): n is Row => !!n)
    .sort(
      (x, y) =>
        ms(x.creationDate) - ms(y.creationDate) || x.id.localeCompare(y.id)
    );
  for (const n of noteList) {
    const list = (per.get(n.id) as Row[]).sort(
      (x, y) =>
        ms(x.creationDate) - ms(y.creationDate) || x.id.localeCompare(y.id)
    );
    const base =
      String(n.sortField ?? "").trim() || noteText(n).slice(0, 100) || "(card)";
    list.forEach((c, i) => {
      text.set(
        c.id,
        list.length > 1 ? `${base} (${i + 1}/${list.length})` : base
      );
      order.push({ card: c, note: n });
    });
  }
  return { text, order };
}

// ---- staging and the card plan --------------------------------------------------------------

class Stage {
  private rows = new Map<string, WriteRow>();
  set(tbl: string, id: string, data: Row, deleted = false) {
    this.rows.set(`${tbl}/${id}`, {
      tbl,
      id,
      data,
      ...(deleted ? { deleted } : {}),
    });
  }
  list() {
    return [...this.rows.values()];
  }
}

interface PlanResult {
  created: string[];
  deleted: string[];
  retired: string[];
  restored: string[];
}

/**
 * Makes the master's cards match planMasterCards, exactly like syncMasterCards in the app: a card
 * the plan wants is kept (a retired one comes back), one it no longer wants is deleted when never
 * reviewed, else suspended and marked `retired` so its history survives. Missing ones are created.
 * Mutates `deck.cards` (a copy owned by the caller) and stages the changed rows.
 */
function syncPlan(
  stage: Stage,
  note: Row,
  sections: MasterSection[],
  cards: Row[],
  deck: Row,
  when: Date,
  newId: (key: string | null) => string
): PlanResult {
  const out: PlanResult = {
    created: [],
    deleted: [],
    retired: [],
    restored: [],
  };
  const want = planMasterCards(sections);
  const wantKeys = new Set(want.map((k) => k ?? ""));
  const have = new Set<string>();
  const keyOf = (c: Row) => String(c.content?.sectionId ?? "");
  const cardIds = new Set<string>(deck.cards ?? []);

  for (const c of cards.filter((x) => x.note === note.id)) {
    const k = keyOf(c);
    if (wantKeys.has(k) && !have.has(k)) {
      have.add(k);
      if (c.content?.retired) {
        stage.set("cards", c.id, {
          ...c,
          content: { ...c.content, retired: false },
          suspended: false,
        });
        out.restored.push(c.id);
      }
    } else if (c.model?.state === 0 && !c.model?.reps) {
      stage.set("cards", c.id, c, true);
      cardIds.delete(c.id);
      out.deleted.push(c.id);
    } else if (!c.content?.retired) {
      stage.set("cards", c.id, {
        ...c,
        content: { ...c.content, retired: true },
        suspended: true,
      });
      out.retired.push(c.id);
    }
  }
  for (const key of want) {
    if (have.has(key ?? "")) continue;
    const id = newId(key);
    stage.set("cards", id, {
      id,
      deck: deck.id,
      note: note.id,
      creationDate: when,
      model: createEmptyCard(when),
      content: { type: MASTER_TYPE, ...(key ? { sectionId: key } : {}) },
    });
    cardIds.add(id);
    out.created.push(id);
  }
  if (out.created.length || out.deleted.length) deck.cards = [...cardIds];
  return out;
}

const noteData = (note: Row, content: MasterNoteContent, extra: Row = {}) => ({
  ...note,
  content: { type: MASTER_TYPE, ...content },
  sortField: masterSortField(content),
  ...extra,
});

const publicShape = (w: World, note: Row, now: number, labels: Labels) => {
  const content = contentOf(note);
  const report = coverageFor(w, note, content.sections, now);
  const entries = countEntries(content.sections);
  return {
    master_id: note.id,
    title: content.title,
    deck_id: note.deck,
    labels,
    summary: countText(labels, content.sections.length, entries),
    coverage: coverageSummary(report),
  };
};

// ---- validation of what a call gives --------------------------------------------------------

/** Every linked card must exist and must not be a master's own study card. */
function checkLinks(w: World, ids: string[]) {
  const by = new Map(w.cards.map((c) => [c.id, c]));
  const notes = new Map(w.notes.map((n) => [n.id, n]));
  const missing = ids.filter((i) => !by.has(i));
  if (missing.length)
    throw new MasterError(
      "card_not_found",
      `unknown card ids: ${missing.slice(0, 5).join(", ")}. Check them with list_cards.`
    );
  const own = ids.filter((i) =>
    isMasterNote(notes.get((by.get(i) as Row).note))
  );
  if (own.length)
    throw new MasterError(
      "invalid_link",
      `${own.slice(0, 5).join(", ")} belong to a master card; an entry links to an ordinary card.`
    );
}

function problemOf(c: MasterNoteContent) {
  const p = validateMaster(c);
  if (p)
    throw new MasterError(
      "invalid_master",
      `${p} (at most ${MASTER_MAX_SECTIONS} sections and ${MASTER_MAX_ENTRIES} entries in total)`
    );
}

const idempotencyKey = (a: Row) => {
  const key = str(a, "idempotency_key")?.trim();
  if (a.idempotency_key !== undefined && (!key || key.length > 200))
    throw new MasterError(
      "invalid_idempotency_key",
      "idempotency_key must be 1 to 200 characters."
    );
  return key;
};

// ---- create_master_card ---------------------------------------------------------------------

type InSection = { title?: unknown; entries?: unknown };

function readSections(
  raw: unknown,
  mk: (part: string) => string,
  fillText: (cardId: string) => string
): MasterSection[] {
  if (!Array.isArray(raw) || !raw.length)
    throw new MasterError(
      "invalid_argument",
      "sections must be a list of {title, entries: [{text, card_id?}]}."
    );
  return raw.map((s: InSection, i) => {
    if (!s || typeof s !== "object" || typeof s.title !== "string")
      throw new MasterError(
        "invalid_argument",
        `section ${i + 1} needs a title.`
      );
    const list = Array.isArray(s.entries) ? s.entries : [];
    const entries: MasterEntry[] = list.map((e: unknown, j) => {
      const o = (typeof e === "string" ? { text: e } : e) as Row;
      if (!o || typeof o !== "object")
        throw new MasterError(
          "invalid_argument",
          `section ${i + 1}, entry ${j + 1} must be text or {text, card_id}.`
        );
      const cardId =
        typeof o.card_id === "string" && o.card_id ? o.card_id : "";
      const text = typeof o.text === "string" ? o.text.trim() : "";
      return {
        id: mk(`s${i}e${j}`),
        text: text || (cardId ? fillText(cardId) : ""),
        ...(cardId ? { cardId } : {}),
      };
    });
    return { id: mk(`s${i}`), title: s.title, entries };
  });
}

/** The deck's own cards (not other masters') as sections, grouped by the note's first tag or all in one. */
function autoSections(
  w: World,
  deck: Row,
  groupBy: "tag" | "none",
  mk: (part: string) => string
): MasterSection[] {
  const deckCards = w.cards.filter((c) => c.deck === deck.id);
  const { order } = entryTexts(w, deckCards);
  const { text } = entryTexts(w, deckCards);
  const groups = new Map<string, MasterEntry[]>();
  for (const { card, note } of order) {
    const title =
      groupBy === "none"
        ? "Cards"
        : ([...(note.tags ?? [])].sort()[0] ?? "Untagged");
    const entry: MasterEntry = {
      id: "",
      text: text.get(card.id) ?? "",
      cardId: card.id,
    };
    groups.set(title, [...(groups.get(title) ?? []), entry]);
  }
  const titles = [...groups.keys()].sort((x, y) =>
    x === "Untagged" ? 1 : y === "Untagged" ? -1 : x.localeCompare(y)
  );
  return titles.map((title, i) => ({
    id: mk(`s${i}`),
    title,
    entries: (groups.get(title) as MasterEntry[]).map((e, j) => ({
      ...e,
      id: mk(`s${i}e${j}`),
    })),
  }));
}

const create_master_card: Tool = {
  name: "create_master_card",
  write: true,
  description: `Create a master card: one compact note that lists every concept and fact of a deck, section by section, with nothing left out. Each entry is short text plus, normally, the card_id of the card that tests it. Like the app: up to 12 entries gives one study card, above that one study card per section (needs two sections); the study cards are created for you and appear in the deck.
Two ways. (1) Write it: title, sections [{title, entries: [{text, card_id?}]}] (an entry may be a plain string; with card_id and no text the card's text is used). (2) Generate it: from_deck true builds it from the deck's own cards (not other masters' cards, not sub-decks), group_by "tag" (default: one section per first tag, untagged last) or "none" (one section "Cards"); every entry is linked to its card. Use dry_run true first to preview (nothing is saved); more than ${MASTER_MAX_SECTIONS} sections or ${MASTER_MAX_ENTRIES} entries is refused (use group_by none, or make one master per sub-deck).
Pass idempotency_key (any string you choose, e.g. "js-closures-master-v1") so a retry returns the same master instead of a second one; reusing a key with different content is [idempotency_conflict]. Optional tags. Any card of any deck may be linked, but coverage counts only this deck's cards. Names in the reply (labels, summary) follow the user's hierarchy settings (for example Chapter and Concept). Returns master_id (the note id), card_ids (its study cards), counts and a coverage summary. Errors start with a code such as [deck_not_found], [card_not_found], [invalid_master].`,
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      title: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  card_id: { type: "string" },
                },
              },
            },
          },
          required: ["title"],
        },
      },
      from_deck: { type: "boolean" },
      group_by: { type: "string", enum: ["tag", "none"] },
      dry_run: { type: "boolean" },
      tags: { type: "array", items: { type: "string" } },
      idempotency_key: { type: "string" },
    },
    required: ["deck_id"],
  },
  async run(ctx, a) {
    const w = await world(ctx);
    const deck = w.decks.find((d) => d.id === str(a, "deck_id"));
    if (!deck)
      throw new MasterError(
        "deck_not_found",
        "no deck has that deck_id. Call list_decks."
      );
    const key = idempotencyKey(a);
    const fromDeck = a.from_deck === true;
    if (fromDeck && a.sections !== undefined)
      throw new MasterError(
        "invalid_argument",
        "give sections or from_deck true, not both."
      );
    const groupBy = str(a, "group_by") ?? "tag";
    if (groupBy !== "tag" && groupBy !== "none")
      throw new MasterError(
        "invalid_argument",
        'group_by must be "tag" or "none".'
      );
    const title =
      (str(a, "title") ?? "").trim() ||
      (fromDeck ? `${deck.name}: master` : "");
    if (!title) throw new MasterError("invalid_argument", "give a title.");
    const tags = Array.isArray(a.tags) ? normalizeTags(a.tags.map(String)) : [];
    const labels = labelsOf(w, deck);

    const mk = (part: string) =>
      key ? detId(ctx.userId, key, part) : newMasterId();
    const noteId = key ? detId(ctx.userId, key, "note") : randomUUID();
    const texts = entryTexts(w, w.cards).text;
    const sectionsIn = fromDeck
      ? autoSections(w, deck, groupBy, mk)
      : readSections(a.sections, mk, (id) => texts.get(id) ?? "(card)");
    // A request fingerprint of what the caller asked for, so a retry can be told from a new call.
    const request = hash([
      deck.id,
      title,
      tags,
      fromDeck
        ? ["from_deck", groupBy]
        : sectionsIn.map((s) => [
            s.title,
            s.entries.map((e) => [e.text, e.cardId ?? null]),
          ]),
    ]);

    if (key) {
      const prior = w.notes.find((n) => n.id === noteId);
      if (prior) {
        if (prior.mcpRequest !== request)
          throw new MasterError(
            "idempotency_conflict",
            `idempotency_key "${key}" was already used with different content. Use a new key for a different master, or repeat the exact same request.`
          );
        return {
          replayed: true,
          created: false,
          ...publicShape(w, prior, ctx.now, labels),
          card_ids: ownCards(w, prior.id).map((c) => c.id),
        };
      }
    }

    const content = cleanMaster({ title, sections: sectionsIn });
    problemOf(content);
    checkLinks(w, linkedCardIds(content.sections));
    const studyCards = planMasterCards(content.sections).length;
    const entries = countEntries(content.sections);

    if (a.dry_run === true)
      return {
        dry_run: true,
        created: false,
        would_create: {
          title: content.title,
          deck_id: deck.id,
          study_cards: studyCards,
          sections: content.sections.map((s) => ({
            title: s.title,
            entries: s.entries.length,
            first_entries: s.entries.slice(0, 5).map((e) => e.text),
          })),
        },
        labels,
        summary: countText(labels, content.sections.length, entries),
        next: "Show the learner this outline. If it is right, repeat the call without dry_run (and with an idempotency_key).",
      };

    const when = new Date(ctx.now);
    const note: Row = {
      id: noteId,
      deck: deck.id,
      creationDate: when,
      linkedNotes: [],
      ...(tags.length ? { tags } : {}),
      ...(key ? { mcpRequest: request } : {}),
    };
    const stage = new Stage();
    const nextDeck: Row = { ...deck, notes: [...(deck.notes ?? []), noteId] };
    const plan = syncPlan(
      stage,
      note,
      content.sections,
      [],
      nextDeck,
      when,
      (k) => (key ? detId(ctx.userId, key, `card:${k ?? ""}`) : randomUUID())
    );
    stage.set("notes", noteId, noteData(note, content));
    stage.set("decks", deck.id, nextDeck);
    try {
      await putRows(ctx, stage.list());
    } catch (e) {
      throw new MasterError(
        "save_failed",
        `the master card could not be saved (${(e as Error).message}); nothing was created. Retry with the same idempotency_key.`
      );
    }
    const report = analyzeCoverage(
      content.sections,
      w.cards.filter((c) => c.deck === deck.id).map(toCoverageCard),
      {
        now: ctx.now,
        ignoreCardIds: w.cards
          .filter((c) => masterNoteIds(w, deck.id).has(c.note))
          .map((c) => c.id),
        externalCardIds: linkedCardIds(content.sections).filter((id) =>
          w.cards.some((c) => c.id === id && c.deck !== deck.id)
        ),
      }
    );
    return {
      replayed: false,
      created: true,
      master_id: noteId,
      title: content.title,
      deck_id: deck.id,
      card_ids: plan.created,
      labels,
      summary: countText(labels, content.sections.length, entries),
      sections: content.sections.map((s) => ({
        id: s.id,
        title: s.title,
        entries: s.entries.length,
      })),
      coverage: coverageSummary(report),
      next: report.complete
        ? "Complete. Use get_master_card to read it back."
        : `Not complete yet: ${describeCoverage(report).join("; ")}. Call master_coverage for fixes.`,
    };
  },
};

// ---- get / list -----------------------------------------------------------------------------

const get_master_card: Tool = {
  name: "get_master_card",
  description: `One master card in full: title, deck, sections with their entries (each entry: text, card_id and the linked card's state, due date, suspended or missing), its own study cards (one per section above 12 entries, retired ones marked), the same content as hand-written text (# section, - entry {{card:id}}), a coverage summary and names that follow the user's hierarchy. Give master_id (from list_master_cards or create_master_card) or the card_id of one of its study cards.
RENAMED TOOL: get_master_card used to return a learning objective's overview. That is now get_objective_overview (same data, arguments objective_id and so on); the old alias was removed. Calling this tool with objective_id returns [renamed_tool].`,
  inputSchema: {
    type: "object",
    properties: { master_id: { type: "string" }, card_id: { type: "string" } },
  },
  async run(ctx, a) {
    if (a.objective_id !== undefined && !a.master_id && !a.card_id)
      throw new MasterError(
        "renamed_tool",
        "get_master_card now returns real master cards (ADR 0014). For a learning objective's overview call get_objective_overview with the same objective_id. To read a master call get_master_card with master_id (see list_master_cards)."
      );
    const w = await world(ctx);
    const note = findMaster(w, a);
    const content = contentOf(note);
    const deck = w.decks.find((d) => d.id === note.deck);
    const labels = labelsOf(w, deck);
    const byCard = new Map(w.cards.map((c) => [c.id, c]));
    const report = coverageFor(w, note, content.sections, ctx.now);
    const entry = (e: MasterEntry) => {
      if (!e.cardId) return { id: e.id, text: e.text, card_id: null };
      const c = byCard.get(e.cardId);
      return {
        id: e.id,
        text: e.text,
        card_id: e.cardId,
        ...(c
          ? {
              card: {
                deck_id: c.deck,
                state: STATES[c.model?.state ?? 0],
                due: c.model?.state ? ms(c.model.due) || null : null,
                suspended: !!c.suspended,
              },
            }
          : { card: null, missing: true }),
      };
    };
    return {
      master_id: note.id,
      title: content.title,
      deck_id: note.deck,
      deck_path: deckPath(w, note.deck),
      tags: note.tags ?? [],
      labels,
      summary: countText(
        labels,
        content.sections.length,
        countEntries(content.sections)
      ),
      sections: content.sections.map((s) => ({
        id: s.id,
        title: s.title,
        entries: s.entries.map(entry),
      })),
      text: masterToText(content.sections),
      study_cards: ownCards(w, note.id).map((c) => ({
        card_id: c.id,
        section_id: c.content?.sectionId ?? null,
        retired: !!c.content?.retired,
        suspended: !!c.suspended,
        state: STATES[c.model?.state ?? 0],
        due: c.model?.state ? ms(c.model.due) || null : null,
      })),
      coverage: coverageSummary(report),
      problems: describeCoverage(report),
    };
  },
};

const list_master_cards: Tool = {
  name: "list_master_cards",
  description: `List master cards with a coverage summary each: share of the deck's cards that some entry covers, and counts of orphan cards (in no entry), dangling entries (card gone), empty sections, entries without a card, stale entries and duplicate groups. Optional deck_id (only masters directly in that deck; add include_sub_decks true for its sub-decks too); without it, every deck. Names follow the user's hierarchy (the labels field). Use master_coverage for the fixes.`,
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      include_sub_decks: { type: "boolean" },
    },
  },
  async run(ctx, a) {
    const w = await world(ctx);
    const deckId = str(a, "deck_id");
    if (deckId && !w.decks.some((d) => d.id === deckId))
      throw new MasterError("deck_not_found", "no deck has that deck_id.");
    const inScope = (n: Row) =>
      !deckId ||
      n.deck === deckId ||
      (a.include_sub_decks === true &&
        (w.decks.find((d) => d.id === n.deck)?.superDecks ?? []).includes(
          deckId
        ));
    const masters = w.notes
      .filter((n) => isMasterNote(n) && inScope(n))
      .sort(
        (x, y) =>
          deckPath(w, x.deck).localeCompare(deckPath(w, y.deck)) ||
          String(x.sortField).localeCompare(String(y.sortField)) ||
          x.id.localeCompare(y.id)
      );
    const deck0 = w.decks.find((d) => d.id === deckId);
    return {
      labels: labelsOf(w, deck0),
      masters: masters.map((n) => {
        const content = contentOf(n);
        const labels = labelsOf(
          w,
          w.decks.find((d) => d.id === n.deck)
        );
        return {
          master_id: n.id,
          title: content.title,
          deck_id: n.deck,
          deck_path: deckPath(w, n.deck),
          summary: countText(
            labels,
            content.sections.length,
            countEntries(content.sections)
          ),
          sections: content.sections.length,
          entries: countEntries(content.sections),
          card_ids: ownCards(w, n.id).map((c) => c.id),
          coverage: coverageSummary(
            coverageFor(w, n, content.sections, ctx.now)
          ),
        };
      }),
    };
  },
};

// ---- update_master_card ---------------------------------------------------------------------

const OPS = [
  "rename_title",
  "add_section",
  "rename_section",
  "move_section",
  "remove_section",
  "add_entry",
  "update_entry",
  "move_entry",
  "remove_entry",
  "link_entry",
  "unlink_entry",
  "add_orphan_cards",
  "remove_dangling_entries",
];

interface OpCtx {
  w: World;
  note: Row;
  sections: MasterSection[];
  title: string;
  mk: (part: string) => string;
  now: number;
}

const bad = (i: number, op: string, msg: string) =>
  new MasterError("invalid_op", `op ${i + 1} (${op}): ${msg}`);

function sectionOf(c: OpCtx, i: number, op: string, id: unknown) {
  const s = c.sections.find((x) => x.id === id);
  if (!s)
    throw new MasterError(
      "section_not_found",
      `op ${i + 1} (${op}): no section with section_id ${String(id)}. Call get_master_card for the ids.`
    );
  return s;
}

function entryOf(c: OpCtx, i: number, op: string, id: unknown) {
  for (const s of c.sections) {
    const idx = s.entries.findIndex((e) => e.id === id);
    if (idx >= 0) return { section: s, index: idx, entry: s.entries[idx] };
  }
  throw new MasterError(
    "entry_not_found",
    `op ${i + 1} (${op}): no entry with entry_id ${String(id)}. Call get_master_card for the ids.`
  );
}

const insertAt = <T>(list: T[], item: T, position: unknown) => {
  const p = Number(position);
  const at =
    position === undefined || !Number.isInteger(p)
      ? list.length
      : Math.min(Math.max(p, 0), list.length);
  list.splice(at, 0, item);
};

const txt = (i: number, op: string, v: unknown, what: string) => {
  if (typeof v !== "string" || !v.trim())
    throw bad(i, op, `${what} must be non-empty text.`);
  return v.trim();
};

function applyOp(c: OpCtx, o: Row, i: number) {
  const op = String(o.op);
  const texts = () => entryTexts(c.w, c.w.cards).text;
  switch (op) {
    case "rename_title":
      c.title = txt(i, op, o.title, "title");
      return;
    case "add_section": {
      const section: MasterSection = {
        id: c.mk(`op${i}:s`),
        title: txt(i, op, o.title, "title"),
        entries: [],
      };
      for (const [j, e] of (Array.isArray(o.entries)
        ? o.entries
        : []
      ).entries()) {
        const x = (typeof e === "string" ? { text: e } : e) as Row;
        const cardId = typeof x?.card_id === "string" ? x.card_id : "";
        const text =
          (typeof x?.text === "string" ? x.text.trim() : "") ||
          (cardId ? (texts().get(cardId) ?? "(card)") : "");
        if (!text && !cardId) continue;
        section.entries.push({
          id: c.mk(`op${i}:s:e${j}`),
          text,
          ...(cardId ? { cardId } : {}),
        });
      }
      insertAt(c.sections, section, o.position);
      return;
    }
    case "rename_section":
      sectionOf(c, i, op, o.section_id).title = txt(i, op, o.title, "title");
      return;
    case "move_section": {
      const s = sectionOf(c, i, op, o.section_id);
      c.sections.splice(c.sections.indexOf(s), 1);
      insertAt(c.sections, s, o.position);
      return;
    }
    case "remove_section":
      c.sections.splice(
        c.sections.indexOf(sectionOf(c, i, op, o.section_id)),
        1
      );
      return;
    case "add_entry": {
      const s = sectionOf(c, i, op, o.section_id);
      const cardId = typeof o.card_id === "string" ? o.card_id : "";
      const text =
        (typeof o.text === "string" ? o.text.trim() : "") ||
        (cardId ? (texts().get(cardId) ?? "(card)") : "");
      if (!text) throw bad(i, op, "give text or a card_id.");
      insertAt(
        s.entries,
        { id: c.mk(`op${i}:e`), text, ...(cardId ? { cardId } : {}) },
        o.position
      );
      return;
    }
    case "update_entry": {
      const { entry } = entryOf(c, i, op, o.entry_id);
      if (o.text === undefined && o.card_id === undefined)
        throw bad(i, op, "give text and/or card_id (null unlinks).");
      if (o.text !== undefined) entry.text = txt(i, op, o.text, "text");
      if (o.card_id === null) entry.cardId = undefined;
      else if (o.card_id !== undefined)
        entry.cardId = txt(i, op, o.card_id, "card_id");
      return;
    }
    case "move_entry": {
      const from = entryOf(c, i, op, o.entry_id);
      const to =
        o.section_id === undefined
          ? from.section
          : sectionOf(c, i, op, o.section_id);
      from.section.entries.splice(from.index, 1);
      insertAt(to.entries, from.entry, o.position);
      return;
    }
    case "remove_entry": {
      const { section, index } = entryOf(c, i, op, o.entry_id);
      section.entries.splice(index, 1);
      return;
    }
    case "link_entry": {
      const { entry } = entryOf(c, i, op, o.entry_id);
      entry.cardId = txt(i, op, o.card_id, "card_id");
      return;
    }
    case "unlink_entry": {
      entryOf(c, i, op, o.entry_id).entry.cardId = undefined;
      return;
    }
    case "add_orphan_cards": {
      const report = coverageFor(c.w, c.note, c.sections, c.now);
      const orphans = new Set(report.orphanCards);
      if (!orphans.size) return;
      const deckCards = c.w.cards.filter((x) => x.deck === c.note.deck);
      const { text, order } = entryTexts(c.w, deckCards);
      const title =
        typeof o.section_title === "string" && o.section_title.trim()
          ? o.section_title.trim()
          : "Unsorted";
      let s =
        o.section_id !== undefined
          ? sectionOf(c, i, op, o.section_id)
          : c.sections.find(
              (x) => x.title.trim().toLowerCase() === title.toLowerCase()
            );
      if (!s) {
        s = { id: c.mk(`op${i}:s`), title, entries: [] };
        c.sections.push(s);
      }
      for (const { card } of order)
        if (orphans.has(card.id))
          s.entries.push({
            id: c.mk(`op${i}:e:${card.id}`),
            text: text.get(card.id) ?? "(card)",
            cardId: card.id,
          });
      return;
    }
    case "remove_dangling_entries": {
      const dead = new Set(
        coverageFor(c.w, c.note, c.sections, c.now).danglingEntries.map(
          (d) => d.entryId
        )
      );
      for (const s of c.sections)
        s.entries = s.entries.filter((e) => !dead.has(e.id));
      return;
    }
    default:
      throw bad(i, op, `unknown op. Use ${OPS.join(", ")}.`);
  }
}

const update_master_card: Tool = {
  name: "update_master_card",
  write: true,
  description: `Change a master card. Pass master_id and an ops list (up to ${MAX_OPS}), applied in order and saved together or not at all; an optional title retitles it. Ops, each an object with "op":
- rename_title {title}
- add_section {title, entries?: [{text, card_id?}], position?}
- rename_section {section_id, title}; move_section {section_id, position}; remove_section {section_id}
- add_entry {section_id, text?, card_id?, position?} (text defaults to the card's text)
- update_entry {entry_id, text?, card_id?} (card_id null unlinks); move_entry {entry_id, section_id?, position?}; remove_entry {entry_id}
- link_entry {entry_id, card_id}; unlink_entry {entry_id}
- add_orphan_cards {section_title? | section_id?}: add an entry for every deck card that is in no entry yet (default section "Unsorted")
- remove_dangling_entries {}: drop every entry whose card is gone
Ids come from get_master_card. position is 0-based; omitted means the end. After the change the study cards follow the same rules as the app: up to 12 entries one card, above that one per section. A card no longer wanted is deleted if it was never reviewed, otherwise suspended and marked retired (history kept); a retired card the plan wants again comes back. Removing a section or entry never deletes the ordinary cards it linked: they become orphans (see master_coverage). A change saves the earlier text in the note's 7-day history (card_history, restore_card_version). Optional idempotency_key makes a retry of the same call a no-op (replayed true); the same key with other ops is [idempotency_conflict]. Returns changed, counts, study card changes (created, deleted, retired, restored), labels in the user's hierarchy names, and the coverage summary.`,
  inputSchema: {
    type: "object",
    properties: {
      master_id: { type: "string" },
      title: { type: "string" },
      ops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: OPS },
            title: { type: "string" },
            text: { type: "string" },
            section_id: { type: "string" },
            section_title: { type: "string" },
            entry_id: { type: "string" },
            card_id: { type: ["string", "null"] },
            position: { type: "integer" },
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  card_id: { type: "string" },
                },
              },
            },
          },
          required: ["op"],
        },
      },
      idempotency_key: { type: "string" },
    },
    required: ["master_id"],
  },
  async run(ctx, a) {
    const key = idempotencyKey(a);
    const opsIn = a.ops === undefined ? [] : a.ops;
    if (!Array.isArray(opsIn) || opsIn.length > MAX_OPS)
      throw new MasterError(
        "invalid_argument",
        `ops must be a list of at most ${MAX_OPS} operations.`
      );
    if (a.title !== undefined && typeof a.title !== "string")
      throw new MasterError("invalid_argument", "title must be text.");
    if (!opsIn.length && a.title === undefined)
      throw new MasterError(
        "invalid_argument",
        "nothing to change: give ops and/or title."
      );
    const w = await world(ctx);
    const note = findMaster(w, a);
    const labels = labelsOf(
      w,
      w.decks.find((d) => d.id === note.deck)
    );
    const request = hash([a.title ?? null, opsIn]);
    if (key && note.mcpUpdate?.key === key) {
      if (note.mcpUpdate.request !== request)
        throw new MasterError(
          "idempotency_conflict",
          `idempotency_key "${key}" was already used with different changes. Use a new key, or repeat the exact same request.`
        );
      const content = contentOf(note);
      return {
        replayed: true,
        changed: false,
        master_id: note.id,
        labels,
        summary: countText(
          labels,
          content.sections.length,
          countEntries(content.sections)
        ),
        coverage: coverageSummary(
          coverageFor(w, note, content.sections, ctx.now)
        ),
      };
    }

    const before = contentOf(note);
    const oc: OpCtx = {
      w,
      note,
      sections: structuredClone(before.sections),
      title: before.title,
      mk: (part) => (key ? detId(ctx.userId, key, part) : newMasterId()),
      now: ctx.now,
    };
    if (typeof a.title === "string") oc.title = a.title;
    for (const [i, o] of opsIn.entries()) {
      if (!o || typeof o !== "object" || typeof (o as Row).op !== "string")
        throw bad(i, "?", 'each op must be an object with an "op" name.');
      applyOp(oc, o as Row, i);
    }
    const content = cleanMaster({ title: oc.title, sections: oc.sections });
    problemOf(content);
    const was = new Set(linkedCardIds(before.sections));
    checkLinks(
      w,
      linkedCardIds(content.sections).filter((id) => !was.has(id))
    );

    const when = new Date(ctx.now);
    const stage = new Stage();
    const deck = w.decks.find((d) => d.id === note.deck);
    const nextDeck: Row | undefined = deck && { ...deck };
    const plan = nextDeck
      ? syncPlan(stage, note, content.sections, w.cards, nextDeck, when, () =>
          randomUUID()
        )
      : { created: [], deleted: [], retired: [], restored: [] };
    const contentChanged =
      JSON.stringify(content) !== JSON.stringify(before) ||
      note.content?.type !== MASTER_TYPE;
    const cardsChanged =
      plan.created.length +
        plan.deleted.length +
        plan.retired.length +
        plan.restored.length >
      0;
    if (contentChanged || key)
      stage.set(
        "notes",
        note.id,
        noteData(note, content, key ? { mcpUpdate: { key, request } } : {})
      );
    if (nextDeck && (plan.created.length || plan.deleted.length))
      stage.set("decks", nextDeck.id, nextDeck);
    if (contentChanged || cardsChanged || key) await putRows(ctx, stage.list());

    const fresh = await world(ctx);
    const freshNote = fresh.notes.find((n) => n.id === note.id) as Row;
    return {
      replayed: false,
      changed: contentChanged || cardsChanged,
      master_id: note.id,
      title: content.title,
      labels,
      summary: countText(
        labels,
        content.sections.length,
        countEntries(content.sections)
      ),
      study_cards: plan,
      coverage: coverageSummary(
        coverageFor(fresh, freshNote, content.sections, ctx.now)
      ),
    };
  },
};

// ---- coverage and rating --------------------------------------------------------------------

const cap = <T>(list: T[]) => ({
  items: list.slice(0, MAX_LIST),
  ...(list.length > MAX_LIST ? { truncated: list.length } : {}),
});

const master_coverage: Tool = {
  name: "master_coverage",
  description: `Check whether a master card really covers its deck with nothing left out, and say how to fix it. Read-only. Reports: orphan cards (cards of the deck in no entry, with their text and tags), dangling entries (the card is gone), empty sections, entries with no card yet, stale entries (their card is suspended, never reviewed or overdue by more than overdue_days, default 30), and duplicate entries (one card used twice, or near-identical text above similarity, default 0.8). Cards of other masters are ignored; entries may link cards of other decks without being dangling; sub-decks are not counted (each has its own master). "complete" means no orphans, dangling, empty or unlinked entries. fix_ops is a ready list for update_master_card: add_entry for each orphan whose tag matches a section title, add_orphan_cards for the rest, remove_dangling_entries and remove_section for empty sections. Show the learner the fixes before applying them. Names follow the user's hierarchy (labels).`,
  inputSchema: {
    type: "object",
    properties: {
      master_id: { type: "string" },
      overdue_days: { type: "integer", minimum: 1 },
      similarity: { type: "number", minimum: 0.3, maximum: 1 },
    },
    required: ["master_id"],
  },
  async run(ctx, a) {
    const w = await world(ctx);
    const note = findMaster(w, a);
    const content = contentOf(note);
    const labels = labelsOf(
      w,
      w.decks.find((d) => d.id === note.deck)
    );
    const od = Number(a.overdue_days);
    const sim = Number(a.similarity);
    const report = coverageFor(w, note, content.sections, ctx.now, {
      overdueDays: Number.isFinite(od) && od >= 1 ? od : undefined,
      similarity:
        Number.isFinite(sim) && sim >= 0.3 && sim <= 1 ? sim : undefined,
    });
    const notes = new Map(w.notes.map((n) => [n.id, n]));
    const byCard = new Map(w.cards.map((c) => [c.id, c]));
    const sectionById = new Map(content.sections.map((s) => [s.id, s]));
    const entryById = new Map(
      content.sections.flatMap((s) => s.entries.map((e) => [e.id, e] as const))
    );
    const { text } = entryTexts(
      w,
      w.cards.filter((c) => c.deck === note.deck)
    );
    const byTitle = new Map(
      content.sections.map((s) => [s.title.trim().toLowerCase(), s])
    );
    const ref = (r: { sectionId: string; entryId: string }) => ({
      section_id: r.sectionId,
      section_title: sectionById.get(r.sectionId)?.title,
      entry_id: r.entryId,
      text: entryById.get(r.entryId)?.text,
    });

    const orphans = report.orphanCards.map((id) => {
      const n = notes.get((byCard.get(id) as Row).note) as Row;
      const tags: string[] = n?.tags ?? [];
      const section = tags
        .map((t) => byTitle.get(t.trim().toLowerCase()))
        .find(Boolean);
      return {
        card_id: id,
        text: text.get(id) ?? "(card)",
        tags,
        suggested_section_id: section?.id ?? null,
        suggested_section_title: section?.title ?? null,
      };
    });
    const fixOps: Row[] = [];
    for (const o of orphans)
      if (o.suggested_section_id)
        fixOps.push({
          op: "add_entry",
          section_id: o.suggested_section_id,
          text: o.text,
          card_id: o.card_id,
        });
    if (orphans.some((o) => !o.suggested_section_id))
      fixOps.push({ op: "add_orphan_cards", section_title: "Unsorted" });
    if (report.danglingEntries.length)
      fixOps.push({ op: "remove_dangling_entries" });
    for (const id of report.emptySections)
      fixOps.push({ op: "remove_section", section_id: id });

    return {
      master_id: note.id,
      title: content.title,
      deck_id: note.deck,
      labels,
      complete: report.complete,
      coverage: coverageSummary(report),
      problems: describeCoverage(report),
      orphan_cards: cap(orphans),
      dangling_entries: cap(
        report.danglingEntries.map((d) => ({ ...ref(d), card_id: d.cardId }))
      ),
      empty_sections: report.emptySections.map((id) => ({
        section_id: id,
        section_title: sectionById.get(id)?.title,
      })),
      unlinked_entries: cap(report.unlinkedEntries.map(ref)),
      stale_entries: cap(
        report.staleEntries.map((s) => ({
          ...ref(s),
          card_id: s.cardId,
          reasons: s.reasons,
        }))
      ),
      duplicates: {
        same_card: report.duplicates.sameCard.map((d) => ({
          card_id: d.cardId,
          entries: d.entries.map(ref),
        })),
        similar_text: report.duplicates.similarText.map((d) => ({
          similarity: Math.round(d.similarity * 100) / 100,
          entries: d.entries.map(ref),
        })),
      },
      fix_ops: fixOps.slice(0, MAX_OPS),
      ...(fixOps.length > MAX_OPS ? { fix_ops_truncated: fixOps.length } : {}),
      next: report.complete
        ? "Nothing is missing."
        : "Show the learner the problems and fixes, then call update_master_card with fix_ops (or part of it).",
    };
  },
};

/** The suggestion for one master study card (or one section of it), from its entries' cards. */
function suggestionFor(
  w: World,
  note: Row,
  sectionId: string | null | undefined,
  now: number
) {
  const content = contentOf(note);
  const shown = sectionsForCard(content.sections, sectionId ?? null);
  const by = new Map(w.cards.map((c) => [c.id, c]));
  const entries = shown.flatMap((s) => s.entries);
  const states = entries.map((e) => {
    const c = e.cardId ? by.get(e.cardId) : undefined;
    return c ? toLinkedState(c) : null;
  });
  const r = suggestMasterRating(states, now, weightsOf(w));
  return {
    rating: r.rating,
    label: r.label,
    score: Math.round(r.score * 1000) / 1000,
    counts: r.counts,
    reasons: r.reasons,
  };
}

/**
 * For show_answer in study sessions: the suggested rating of a master study card. Reference only,
 * the learner rates. Loads only what it needs.
 */
export async function masterSuggestion(ctx: Ctx, card: Row, note: Row) {
  const [cards, settings] = await Promise.all([
    load(ctx.db, ctx.userId, "cards"),
    load(ctx.db, ctx.userId, "settings"),
  ]);
  return suggestionFor(
    { decks: [], cards, notes: [], settings },
    note,
    card.content?.sectionId,
    ctx.now
  );
}

const suggest_master_rating: Tool = {
  name: "suggest_master_rating",
  description:
    "A suggested rating (1 Again, 2 Hard, 3 Good, 4 Easy) for reviewing a master card, worked out from the FSRS state of the cards its entries link to: mean recall chance now (an entry with no card or a never-reviewed card counts as not known; suspended cards are left out); under 0.5 Again, under 0.8 Hard, under 0.93 Good, else Easy, and Easy needs every entry linked, reviewed and not overdue. Read-only, returns rating, label, score, counts and reasons. It is only a suggestion: the learner rates themselves. Never submit it as their rating. Give master_id for the whole master, or the card_id of one study card (one section) or a section_id to judge a single section.",
  inputSchema: {
    type: "object",
    properties: {
      master_id: { type: "string" },
      card_id: { type: "string" },
      section_id: { type: "string" },
    },
  },
  async run(ctx, a) {
    const w = await world(ctx);
    const note = findMaster(w, a);
    let sectionId = str(a, "section_id");
    if (sectionId && !contentOf(note).sections.some((s) => s.id === sectionId))
      throw new MasterError(
        "section_not_found",
        "no section with that section_id. Call get_master_card."
      );
    const cardId = str(a, "card_id");
    if (!sectionId && cardId) {
      const c = w.cards.find((x) => x.id === cardId && x.note === note.id);
      if (c) sectionId = c.content?.sectionId ?? undefined;
    }
    const labels = labelsOf(
      w,
      w.decks.find((d) => d.id === note.deck)
    );
    return {
      master_id: note.id,
      scope: sectionId ? { section_id: sectionId } : "whole master",
      labels,
      ...suggestionFor(w, note, sectionId, ctx.now),
      note: "A suggestion only. Ask the learner for their own rating; never record this one for them.",
    };
  },
};

// ---- delete ---------------------------------------------------------------------------------

const delete_master_card: Tool = {
  name: "delete_master_card",
  write: true,
  destructive: true,
  description:
    "Delete a master card: its note and its own study cards (their review history is kept). The ordinary cards its entries linked are NOT touched; they just stop being covered. Two steps: call without confirm_token to see what would be deleted and get a token; ask the learner; then repeat with that confirm_token. The token only fits the exact master (sections, entries and study cards) it was made for. To change a master instead, use update_master_card.",
  inputSchema: {
    type: "object",
    properties: {
      master_id: { type: "string" },
      confirm_token: { type: "string" },
    },
    required: ["master_id"],
  },
  async run(ctx, a) {
    const w = await world(ctx);
    const note = findMaster(w, a);
    const content = contentOf(note);
    const cards = ownCards(w, note.id).sort((x, y) => x.id.localeCompare(y.id));
    const entries = countEntries(content.sections);
    const token = confirmToken(
      ctx,
      "master",
      note.id,
      content.sections.length,
      entries,
      ...cards.map((c) => c.id)
    );
    const labels = labelsOf(
      w,
      w.decks.find((d) => d.id === note.deck)
    );
    if (a.confirm_token !== token) {
      if (a.confirm_token !== undefined)
        throw new MasterError(
          "confirm_token_mismatch",
          `the master card changed or the token is wrong. ${CONFIRM_HINT}`
        );
      return {
        deleted: false,
        will_delete: {
          title: content.title,
          summary: countText(labels, content.sections.length, entries),
          study_cards: cards.length,
          reviewed_study_cards: cards.filter((c) => c.model?.reps).length,
        },
        untouched: `${linkedCardIds(content.sections).length} linked card(s) stay where they are.`,
        confirm_token: token,
        message: CONFIRM_HINT,
      };
    }
    const stage = new Stage();
    const deck = w.decks.find((d) => d.id === note.deck);
    stage.set("notes", note.id, note, true);
    for (const c of cards) stage.set("cards", c.id, c, true);
    if (deck) {
      const gone = new Set(cards.map((c) => c.id));
      stage.set("decks", deck.id, {
        ...deck,
        notes: (deck.notes ?? []).filter((x: string) => x !== note.id),
        cards: (deck.cards ?? []).filter((x: string) => !gone.has(x)),
      });
    }
    await putRows(ctx, stage.list());
    return { deleted: true, master_id: note.id, study_cards: cards.length };
  },
};

export const MASTER_TOOLS: Tool[] = [
  create_master_card,
  get_master_card,
  list_master_cards,
  update_master_card,
  master_coverage,
  suggest_master_rating,
  delete_master_card,
];

/**
 * Re-applies the card plan after a master note was rewritten behind the plan's back (restoring an
 * older version). Returns the rows to write, or none when nothing is out of step.
 */
export function replanRows(
  note: Row,
  cards: Row[],
  deck: Row | undefined,
  now: number
): WriteRow[] {
  if (!isMasterNote(note) || !deck) return [];
  const stage = new Stage();
  const nextDeck = { ...deck };
  const plan = syncPlan(
    stage,
    note,
    contentOf(note).sections,
    cards,
    nextDeck,
    new Date(now),
    () => randomUUID()
  );
  if (plan.created.length || plan.deleted.length)
    stage.set("decks", nextDeck.id, nextDeck);
  return stage.list();
}
