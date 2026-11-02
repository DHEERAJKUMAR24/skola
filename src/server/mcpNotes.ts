import {
  IO_MAX_BOXES,
  type OcclusionBox,
  validateImageOcclusion,
} from "../logic/type-implementations/image-occlusion/types";
import {
  parseListText,
  validateList,
} from "../logic/type-implementations/list/types";
import {
  cleanChoices,
  validateMultipleChoice,
} from "../logic/type-implementations/multiple-choice/types";
import { loadAsset, noteImageFor, readImageSource } from "./imageAssets";
import type { Ctx } from "./mcpData";
import {
  MAX_IMAGE_BYTES,
  checkImageUrl,
  parseImageInput,
  toDataUrl,
} from "./mcpImage";
import { MAX_MEDIA_BYTES, mediaEnabled, storeBytes } from "./media";

const MAX_TEXT = 10_000;
const MAX_CLOZE_NUMBER = 20;
const MIN_AREA_SIDE = 0.01;
const CLOZE = /\{\{c(\d+)::((?!\{\{|}}).)*\}\}/g;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text to the HTML the editor stores: one paragraph per line. */
export const html = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => `<p>${esc(l)}</p>`)
    .join("");

const preview = (s: string) => s.replace(/<[^>]*>/g, "").slice(0, 100);

type Item = Record<string, unknown>;
type Content = Record<string, any>;

function text(item: Item, key: string, required = true): string | undefined {
  const v = item[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== "string" || !v.trim() || v.length > MAX_TEXT)
    throw new Error(
      `${key} must be a non-empty string under ${MAX_TEXT} chars`
    );
  return v;
}

export interface BuiltNote {
  /** What the note row stores as `content`. */
  content: Record<string, unknown>;
  sortField: string;
  /** One entry per card to create; each is that card's `content`. */
  cards: Record<string, unknown>[];
}

export const CARD_TYPES = [
  "basic",
  "cloze",
  "multiple_choice",
  "list",
  "image_occlusion",
] as const;

// ---- shared pieces -------------------------------------------------------------------------

function clozeNumbers(raw: string): number[] {
  const numbers = [
    ...new Set([...raw.matchAll(CLOZE)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
  if (!numbers.length)
    throw new Error("cloze text needs at least one {{c1::hidden words}}");
  if (numbers.some((n) => n < 1 || n > MAX_CLOZE_NUMBER))
    throw new Error(`cloze numbers go from 1 to ${MAX_CLOZE_NUMBER}`);
  return numbers;
}

const clozeSort = (rawHtml: string) =>
  preview(rawHtml.replace(CLOZE, (m) => m.slice(m.indexOf("::") + 2, -2)));

function mcChoices(item: Item) {
  if (!Array.isArray(item.choices))
    throw new Error("choices must be a list of strings");
  const correct = new Set(
    (Array.isArray(item.correct) ? item.correct : [item.correct]).map(Number)
  );
  const choices = item.choices.map((c, i) => ({
    text: String(c),
    correct: correct.has(i),
  }));
  if (
    [...correct].some(
      (i) => !Number.isInteger(i) || i < 0 || i >= choices.length
    )
  )
    throw new Error("correct lists the 0-based positions of the right choices");
  return cleanChoices(choices);
}

function listItems(item: Item): string[] {
  return Array.isArray(item.items)
    ? item.items.flatMap((i) => parseListText(String(i)))
    : parseListText(text(item, "items") ?? "");
}

/** Reads `areas` as fractions of the picture (0 to 1, from the top left). */
function parseAreas(
  value: unknown,
  existing: OcclusionBox[] = []
): OcclusionBox[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error("areas must be a list of {x, y, w, h} between 0 and 1");
  const boxes = new Map(existing.map((b) => [b.id, b]));
  let next = existing.reduce((m, b) => Math.max(m, b.id), 0) + 1;
  for (const a of value as Item[]) {
    const [x, y, w, h] = [a.x, a.y, a.w, a.h].map(Number);
    if (![x, y, w, h].every(Number.isFinite))
      throw new Error("each area needs numbers x, y, w and h");
    if (x < 0 || y < 0 || x > 1 || y > 1 || x + w > 1.0001 || y + h > 1.0001)
      throw new Error(
        "areas are fractions of the picture: x, y from 0 (top left) to 1, and x+w, y+h at most 1"
      );
    if (w < MIN_AREA_SIDE || h < MIN_AREA_SIDE)
      throw new Error(
        "an area must be at least 1% of the picture wide and tall"
      );
    const given = a.id === undefined ? undefined : Number(a.id);
    if (given !== undefined && !boxes.has(given))
      throw new Error(`area id ${given} does not exist on this picture`);
    const id = given ?? next++;
    boxes.set(id, { id, x, y, w, h });
  }
  return [...boxes.values()].sort((p, q) => p.id - q.id);
}

/**
 * The picture of a card: an https link is kept as it is (never downloaded); bytes go to R2 when it
 * is set up and are referenced as `media:<sha256>`, otherwise they stay inside the note.
 */
async function pictureOf(item: Item, ctx: Ctx): Promise<string | undefined> {
  if (item.image_asset_id !== undefined)
    return (await noteImageFor(ctx, await loadAsset(ctx, item.image_asset_id)))
      .image;
  const stored = mediaEnabled();
  const limit = stored ? MAX_MEDIA_BYTES : MAX_IMAGE_BYTES;
  const raw =
    typeof item.image === "string" ? item.image.trim() : item.image_base64;
  if (typeof raw === "string" && raw.trim()) {
    const bytes = parseImageInput(raw, limit);
    if (!stored) return toDataUrl(bytes);
    return `media:${await storeBytes(ctx.db, ctx.userId, bytes)}`;
  }
  // A file reference from an AI client ({ download_url, ... }): Skola downloads and stores it.
  if (item.image && typeof item.image === "object") {
    const bytes = await readImageSource({ image: item.image }, limit);
    if (!stored) return toDataUrl(bytes);
    return `media:${await storeBytes(ctx.db, ctx.userId, bytes)}`;
  }
  if (typeof item.image_url === "string" && item.image_url.trim())
    return checkImageUrl(item.image_url);
  return undefined;
}

// ---- creating ------------------------------------------------------------------------------

/**
 * Turns one add_cards item into the note and card contents the app stores, using the same rules
 * as its editors.
 */
export async function buildNote(item: Item, ctx: Ctx): Promise<BuiltNote> {
  const type = typeof item.type === "string" ? item.type : "basic";
  switch (type) {
    case "basic": {
      const front = html(text(item, "front") as string);
      return {
        content: {
          type: "normal",
          front,
          back: html(text(item, "back") as string),
        },
        sortField: preview(front),
        cards: [{ type: "normal" }],
      };
    }
    case "cloze": {
      const raw = html(text(item, "text") as string);
      return {
        content: { type: "cloze", text: raw },
        sortField: clozeSort(raw),
        cards: clozeNumbers(raw).map((n) => ({
          type: "cloze",
          occlusionNumber: n,
        })),
      };
    }
    case "multiple_choice": {
      const question = text(item, "question") as string;
      const choices = mcChoices(item);
      const problem = validateMultipleChoice({ question, choices });
      if (problem) throw new Error(problem);
      const explanation = text(item, "explanation", false);
      return {
        content: {
          type: "multipleChoice",
          question: html(question),
          choices,
          ...(explanation ? { explanation: html(explanation) } : {}),
        },
        sortField: preview(html(question)),
        cards: [{ type: "multipleChoice" }],
      };
    }
    case "list": {
      const front = text(item, "front") as string;
      const items = listItems(item);
      const problem = validateList({ front, items });
      if (problem) throw new Error(problem);
      return {
        content: {
          type: "list",
          front: html(front),
          items,
          ordered: item.ordered === true,
        },
        sortField: preview(html(front)),
        cards: [{ type: "list" }],
      };
    }
    case "image_occlusion": {
      const image = await pictureOf(item, ctx);
      if (!image)
        throw new Error("give image (a data URL or base64) or image_url");
      const boxes = parseAreas(item.areas);
      const content = {
        type: "imageOcclusion",
        image,
        boxes,
        hideAll: item.hide_all !== false,
        ...(typeof item.header === "string" && item.header.trim()
          ? { header: item.header.trim() }
          : {}),
      };
      const problem = validateImageOcclusion(content);
      if (problem) throw new Error(problem);
      return {
        content,
        sortField: (content as { header?: string }).header ?? "Image occlusion",
        cards: boxes.map((b) => ({
          type: "imageOcclusion",
          occlusionNumber: b.id,
        })),
      };
    }
    default:
      throw new Error(
        `unknown card type "${type}" (use ${CARD_TYPES.join(", ")})`
      );
  }
}

// ---- editing -------------------------------------------------------------------------------

export interface NoteEdit {
  content: Record<string, unknown>;
  sortField: string;
  /** Cards to add for new cloze numbers or picture areas. */
  newCards: Record<string, unknown>[];
}

/** The fields edit_card reads, by card type; used to tell "nothing to change" from a real edit. */
const EDIT_FIELDS = [
  "front",
  "back",
  "text",
  "question",
  "choices",
  "correct",
  "explanation",
  "items",
  "ordered",
  "header",
  "hide_all",
  "areas",
  "image",
  "image_url",
];

export const hasContentEdit = (item: Item) =>
  EDIT_FIELDS.some((k) => item[k] !== undefined);

/**
 * Applies the fields of an edit_card call to a note's content, with the same rules as creating.
 * Only the fields given change. `existingNumbers` are the occlusion numbers that already have a
 * card, so only new ones get a card; removed ones keep theirs (suspend those instead).
 */
export async function editNote(
  content: Content,
  item: Item,
  existingNumbers: number[],
  ctx: Ctx
): Promise<NoteEdit> {
  const wrong = (names: string[]) => {
    const stray = names.filter((k) => item[k] !== undefined);
    if (stray.length)
      throw new Error(
        `${stray.join(", ")} do not apply to a ${content.type} card`
      );
  };

  switch (content.type) {
    case "normal": {
      wrong([
        "text",
        "question",
        "choices",
        "correct",
        "explanation",
        "items",
        "ordered",
        "header",
        "hide_all",
        "areas",
        "image",
        "image_url",
      ]);
      const front =
        item.front !== undefined
          ? html(text(item, "front") as string)
          : content.front;
      const back =
        item.back !== undefined
          ? html(text(item, "back") as string)
          : content.back;
      return {
        content: { ...content, front, back },
        sortField: preview(front),
        newCards: [],
      };
    }
    case "cloze": {
      wrong([
        "front",
        "back",
        "question",
        "choices",
        "correct",
        "explanation",
        "items",
        "ordered",
        "header",
        "hide_all",
        "areas",
        "image",
        "image_url",
      ]);
      const raw = html(text(item, "text") as string);
      const have = new Set(existingNumbers);
      return {
        content: { ...content, text: raw },
        sortField: clozeSort(raw),
        newCards: clozeNumbers(raw)
          .filter((n) => !have.has(n))
          .map((n) => ({ type: "cloze", occlusionNumber: n })),
      };
    }
    case "multipleChoice": {
      wrong([
        "front",
        "back",
        "text",
        "items",
        "ordered",
        "header",
        "hide_all",
        "areas",
        "image",
        "image_url",
      ]);
      if ((item.choices === undefined) !== (item.correct === undefined))
        throw new Error("send choices and correct together");
      const question =
        item.question !== undefined
          ? html(text(item, "question") as string)
          : content.question;
      const choices =
        item.choices !== undefined ? mcChoices(item) : content.choices;
      // An empty string clears the explanation.
      const rawExplanation = item.explanation;
      if (
        typeof rawExplanation === "string" &&
        rawExplanation.length > MAX_TEXT
      )
        throw new Error(`explanation must be under ${MAX_TEXT} chars`);
      const explanation =
        rawExplanation === undefined
          ? content.explanation
          : typeof rawExplanation === "string" && rawExplanation.trim()
            ? html(rawExplanation)
            : undefined;
      const problem = validateMultipleChoice({ question, choices });
      if (problem) throw new Error(problem);
      return {
        content: {
          ...content,
          question,
          choices,
          ...(explanation ? { explanation } : { explanation: undefined }),
        },
        sortField: preview(question),
        newCards: [],
      };
    }
    case "list": {
      wrong([
        "back",
        "text",
        "question",
        "choices",
        "correct",
        "explanation",
        "header",
        "hide_all",
        "areas",
        "image",
        "image_url",
      ]);
      const front =
        item.front !== undefined
          ? html(text(item, "front") as string)
          : content.front;
      const items = item.items !== undefined ? listItems(item) : content.items;
      const problem = validateList({ front, items });
      if (problem) throw new Error(problem);
      return {
        content: {
          ...content,
          front,
          items,
          ordered:
            item.ordered !== undefined
              ? item.ordered === true
              : content.ordered,
        },
        sortField: preview(front),
        newCards: [],
      };
    }
    case "imageOcclusion": {
      wrong([
        "front",
        "back",
        "text",
        "question",
        "choices",
        "correct",
        "explanation",
        "items",
        "ordered",
      ]);
      const image = (await pictureOf(item, ctx)) ?? content.image;
      const boxes =
        item.areas !== undefined
          ? parseAreas(item.areas, content.boxes)
          : content.boxes;
      if (boxes.length > IO_MAX_BOXES)
        throw new Error(`at most ${IO_MAX_BOXES} areas`);
      const header =
        item.header === undefined
          ? content.header
          : typeof item.header === "string" && item.header.trim()
            ? item.header.trim()
            : undefined;
      const next = {
        ...content,
        image,
        boxes,
        hideAll:
          item.hide_all !== undefined
            ? item.hide_all !== false
            : content.hideAll,
        header,
      };
      const problem = validateImageOcclusion(next);
      if (problem) throw new Error(problem);
      const have = new Set(existingNumbers);
      return {
        content: next,
        sortField: header ?? "Image occlusion",
        newCards: boxes
          .filter((b: OcclusionBox) => !have.has(b.id))
          .map((b: OcclusionBox) => ({
            type: "imageOcclusion",
            occlusionNumber: b.id,
          })),
      };
    }
    default:
      throw new Error(
        `${content.type ?? "this"} cards cannot be edited here; edit them in the app`
      );
  }
}
