import { createHash, randomUUID } from "node:crypto";
import { createEmptyCard } from "ts-fsrs";
import { normalizeTags } from "../logic/note/tagNormalize";
import {
  IO_MAX_BOXES,
  IO_MAX_URL_CHARS,
  type OcclusionBox,
  isImageUrl,
  validateImageOcclusion,
} from "../logic/type-implementations/image-occlusion/types";
import {
  ASSET_MAX_BYTES,
  ASSET_USER_BYTES,
  ImageError,
  type ImageSource,
  loadAsset,
  noteImageFor,
  readImageSource,
  saveAsset,
} from "./imageAssets";
import { imageSize } from "./imageInfo";
import type { ContentResult } from "./mcpCardImage";
import {
  type Args,
  type Ctx,
  type Row,
  type Tool,
  type WriteRow,
  putRows,
  str,
} from "./mcpData";
import { MAX_IMAGE_BYTES, sniffImage } from "./mcpImage";
import { mediaEnabled } from "./media";

const MIN_SIDE = 0.01;
const EPS = 1e-4;

/** One id per (user, key, part), so a retry with the same key rewrites the same rows. */
function detId(userId: string, key: string, part: string) {
  const h = createHash("sha256")
    .update(`${userId}\0${key}\0${part}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Reads `areas` (fractions of the picture, from its top left) and says which area is wrong. */
export function checkAreas(value: unknown): OcclusionBox[] {
  if (!Array.isArray(value) || !value.length)
    throw new ImageError(
      "invalid_areas",
      "areas must be a non-empty list of {x, y, w, h}.",
      "Each value is a fraction of the picture from 0 to 1; x, y is the top-left corner."
    );
  if (value.length > IO_MAX_BOXES)
    throw new ImageError(
      "too_many_areas",
      `${value.length} areas were given; at most ${IO_MAX_BOXES} fit on one picture.`,
      "Split the picture into two sets of cards."
    );
  const given = value as Row[];
  const taken = new Set(
    given.map((a) => Number(a?.id)).filter((n) => Number.isInteger(n))
  );
  const used = new Set<number>();
  const boxes: OcclusionBox[] = [];
  let next = 1;
  for (const [i, a] of given.entries()) {
    const n = i + 1;
    const [x, y, w, h] = [a?.x, a?.y, a?.w, a?.h].map(Number);
    if (![x, y, w, h].every(Number.isFinite))
      throw new ImageError(
        "invalid_areas",
        `area ${n}: x, y, w and h must all be numbers.`
      );
    if (x < 0 || y < 0)
      throw new ImageError(
        "invalid_areas",
        `area ${n}: x and y must be 0 or more (x=${x}, y=${y}).`,
        "0, 0 is the top-left corner."
      );
    if (w <= 0 || h <= 0)
      throw new ImageError(
        "invalid_areas",
        `area ${n}: w and h must be greater than 0 (w=${w}, h=${h}).`
      );
    if (w < MIN_SIDE || h < MIN_SIDE)
      throw new ImageError(
        "invalid_areas",
        `area ${n}: an area must be at least 1% of the picture wide and tall.`
      );
    if (x + w > 1 + EPS || y + h > 1 + EPS)
      throw new ImageError(
        "invalid_areas",
        `area ${n} leaves the picture: x+w=${+(x + w).toFixed(4)}, y+h=${+(y + h).toFixed(4)}; both must be at most 1.`,
        "Coordinates are fractions of the picture, not pixels: divide pixels by the picture width and height."
      );
    let id: number;
    if (a.id === undefined) {
      while (taken.has(next) || used.has(next)) next++;
      id = next;
    } else {
      id = Number(a.id);
      if (!Number.isInteger(id) || id < 1 || used.has(id))
        throw new ImageError(
          "invalid_areas",
          `area ${n}: id must be a unique whole number from 1.`
        );
    }
    used.add(id);
    const label =
      typeof a.label === "string" ? a.label.trim().slice(0, 200) : "";
    boxes.push({ id, x, y, w, h, ...(label ? { label } : {}) });
  }
  return boxes.sort((p, q) => p.id - q.id);
}

const AREA_SCHEMA = {
  type: "array",
  description: `1 to ${IO_MAX_BOXES} hidden regions. x, y, w, h are FRACTIONS of the picture (0 to 1) measured from its top-left corner: x, y is the corner, w, h the size; x+w and y+h must be at most 1. Pixels divided by picture size gives the fraction, so resizing the picture never moves an area. Each area becomes one card.`,
  items: {
    type: "object",
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      w: { type: "number" },
      h: { type: "number" },
      id: {
        type: "integer",
        description: "Optional stable number for this area (1, 2, ...).",
      },
      label: {
        type: "string",
        description:
          'Optional name of what is hidden, for example "Call Stack". It is kept with the area and returned by get_card_image.',
      },
    },
    required: ["x", "y", "w", "h"],
  },
};

const SOURCE_PROPS = {
  image_asset_id: {
    type: "string",
    description:
      "Id returned by upload_image_asset. Preferred: upload once, reuse for many calls.",
  },
  image_base64: {
    type: "string",
    description:
      "A data URL (data:image/png;base64,...) or bare base64 of a PNG, JPEG, WebP or GIF.",
  },
  image: {
    type: "object",
    description:
      "A file reference from an AI client, for example a generated or attached picture: { download_url, file_id }. Skola downloads the picture from download_url.",
    properties: {
      download_url: { type: "string" },
      file_id: { type: "string" },
    },
  },
  image_url: {
    type: "string",
    description:
      "A public https link to the picture (no login). create_image_occlusion_cards keeps the link and shows the picture from it; upload_image_asset downloads it.",
  },
};

/** Which picture a call means: stored bytes, fresh bytes, or a link to keep. */
async function pictureFrom(ctx: Ctx, a: Args) {
  if (a.image_asset_id !== undefined) {
    const asset = await loadAsset(ctx, a.image_asset_id);
    return { kind: "bytes" as const, asset, ident: asset.image_asset_id };
  }
  const link = str(a, "image_url")?.trim();
  if (link && !a.image && !a.image_base64) {
    if (!isImageUrl(link))
      throw new ImageError(
        "invalid_url",
        `image_url must be a plain https link without a login, up to ${IO_MAX_URL_CHARS} characters.`
      );
    return { kind: "link" as const, url: link, ident: link };
  }
  const bytes = await readImageSource(a as ImageSource, ASSET_MAX_BYTES);
  const kind = sniffImage(bytes);
  if (!kind)
    throw new ImageError(
      "invalid_image",
      "this is not a PNG, JPEG, WebP or GIF file, or the file is corrupted."
    );
  const size = imageSize(bytes, kind);
  if (!size)
    throw new ImageError(
      "invalid_image",
      "the picture header is damaged, so its size cannot be read."
    );
  return {
    kind: "raw" as const,
    bytes,
    imgKind: kind,
    size,
    ident: createHash("sha256").update(bytes).digest("hex"),
  };
}

const upload_image_asset: Tool = {
  name: "upload_image_asset",
  write: true,
  meta: { "openai/fileParams": ["image"] },
  description: `Upload a picture once and get a stable image_asset_id to reuse for create_image_occlusion_cards, preview_image_occlusion and add_cards. Give exactly one of: image_base64 (data URL or base64 of a PNG, JPEG, WebP or GIF), image (a file reference with download_url, which Skola downloads) or image_url (a public https link, downloaded). Up to ${ASSET_MAX_BYTES / 1_000_000} MB per picture; a single request is limited to about 4 MB on Vercel, so send larger pictures as image_url. Returns image_asset_id, mime_type, size_bytes, width and height in pixels. The same bytes always give the same id, so retrying is safe. Errors start with a code such as [invalid_image] or [image_too_large], then what to do.`,
  inputSchema: {
    type: "object",
    properties: {
      image_base64: SOURCE_PROPS.image_base64,
      image: SOURCE_PROPS.image,
      image_url: SOURCE_PROPS.image_url,
    },
  },
  async run(ctx, a) {
    const bytes = await readImageSource(a as ImageSource);
    return {
      ...(await saveAsset(ctx, bytes)),
      next: "Pass image_asset_id to create_image_occlusion_cards with the areas to hide.",
    };
  },
};

const get_image_asset: Tool = {
  name: "get_image_asset",
  description:
    "Check an uploaded picture: its mime type, size in bytes, width and height in pixels. Set include_image to true to also get the picture itself, so you can look at it and place areas.",
  inputSchema: {
    type: "object",
    properties: {
      image_asset_id: { type: "string" },
      include_image: { type: "boolean" },
    },
    required: ["image_asset_id"],
  },
  async run(ctx, a) {
    const {
      data,
      kind: _kind,
      ...info
    } = await loadAsset(ctx, a.image_asset_id);
    if (a.include_image !== true) return info;
    const out: ContentResult = {
      __content: [
        { type: "text", text: JSON.stringify(info) },
        {
          type: "image",
          data: data.toString("base64"),
          mimeType: info.mime_type,
        },
      ],
    };
    return out;
  },
};

function overlaps(boxes: OcclusionBox[]) {
  const out: [number, number][] = [];
  for (const [i, p] of boxes.entries())
    for (const q of boxes.slice(i + 1))
      if (
        p.x < q.x + q.w &&
        q.x < p.x + p.w &&
        p.y < q.y + q.h &&
        q.y < p.y + p.h
      )
        out.push([p.id, q.id]);
  return out;
}

const preview_image_occlusion: Tool = {
  name: "preview_image_occlusion",
  description:
    "Check hidden areas before saving anything. Takes the same picture and areas as create_image_occlusion_cards (the picture is optional; give it to get pixel positions) and returns: whether the areas are valid, how many cards would be created, every area as fractions and as pixels, which areas overlap, and preview_svg, a small SVG drawing of where the areas sit. Nothing is stored. A problem comes back as an error naming the area number.",
  inputSchema: {
    type: "object",
    properties: {
      ...SOURCE_PROPS,
      areas: AREA_SCHEMA,
      hide_all: { type: "boolean" },
    },
    required: ["areas"],
  },
  async run(ctx, a) {
    const boxes = checkAreas(a.areas);
    const hasPicture = [
      "image_asset_id",
      "image_base64",
      "image",
      "image_url",
    ].some((k) => a[k] !== undefined);
    let dims: { width: number; height: number } | null = null;
    if (hasPicture) {
      const p = await pictureFrom(ctx, a);
      if (p.kind === "bytes") dims = p.asset;
      else if (p.kind === "raw") dims = p.size;
    }
    const W = dims?.width ?? 1000;
    const H = dims?.height ?? 1000;
    const px = (b: OcclusionBox) => ({
      x: Math.round(b.x * W),
      y: Math.round(b.y * H),
      w: Math.round(b.w * W),
      h: Math.round(b.h * H),
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#eee"/>${boxes
      .map((b) => {
        const r = px(b);
        return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#222" fill-opacity=".85"/><text x="${r.x + 6}" y="${r.y + 22}" font-size="20" fill="#fff">${b.id}</text>`;
      })
      .join("")}</svg>`;
    return {
      valid: true,
      cards_that_would_be_created: boxes.length,
      hide_all: a.hide_all !== false,
      image: dims && { width: dims.width, height: dims.height },
      areas: boxes.map((b) => ({
        area_id: b.id,
        label: b.label,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        pixels: dims ? px(b) : null,
      })),
      overlapping_areas: overlaps(boxes),
      preview_svg: svg,
    };
  },
};

const create_image_occlusion_cards: Tool = {
  name: "create_image_occlusion_cards",
  write: true,
  meta: { "openai/fileParams": ["image"] },
  description: `Make image-occlusion flashcards from a picture and the areas to hide, in one call. Give the picture as image_asset_id (best: from upload_image_asset), or image_base64, or image (file reference with download_url), or image_url (a public https link that is kept and shown from the link). areas is a list of {x, y, w, h, label?} as fractions (0 to 1) of the picture from its top-left corner; each area becomes exactly one card. hide_all (default true): every area is covered and one is asked; false: only the asked area is covered. Optional header and tags. Pass idempotency_key (any string you choose, for example "event-loop-v1") so a retry after a timeout returns the same cards instead of making duplicates; reusing a key with different content is an error. Pictures are stored in R2 when set up, otherwise kept in the card (up to ${MAX_IMAGE_BYTES / 1000} KB). All cards are saved together or not at all. Returns note_id, card_ids, one entry per card {card_id, area_id, label}, cards_created and replayed. Check the result with get_card_image. Errors start with a code such as [invalid_areas] naming the area, [asset_not_found], [image_too_large_for_inline] or [idempotency_conflict].`,
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      ...SOURCE_PROPS,
      header: { type: "string" },
      hide_all: { type: "boolean" },
      areas: AREA_SCHEMA,
      tags: { type: "array", items: { type: "string" } },
      idempotency_key: { type: "string" },
    },
    required: ["deck_id", "areas"],
  },
  async run(ctx, a) {
    const { rows: deckRows } = await ctx.db.query<{ data: Row }>(
      "SELECT data FROM changes WHERE user_id = $1 AND tbl = 'decks' AND id = $2 AND NOT deleted",
      [ctx.userId, str(a, "deck_id") ?? ""]
    );
    const deck = deckRows[0]?.data;
    if (!deck)
      throw new ImageError(
        "deck_not_found",
        "no deck has that deck_id.",
        "Call list_decks, or create_deck first."
      );
    const boxes = checkAreas(a.areas);
    const key = str(a, "idempotency_key")?.trim();
    if (a.idempotency_key !== undefined && (!key || key.length > 200))
      throw new ImageError(
        "invalid_idempotency_key",
        "idempotency_key must be 1 to 200 characters."
      );
    const pic = await pictureFrom(ctx, a);
    const header =
      typeof a.header === "string" && a.header.trim()
        ? a.header.trim()
        : undefined;
    const hideAll = a.hide_all !== false;
    const tags = Array.isArray(a.tags) ? normalizeTags(a.tags.map(String)) : [];
    const request = createHash("sha256")
      .update(
        JSON.stringify([deck.id, pic.ident, header, hideAll, boxes, tags])
      )
      .digest("hex");

    const noteId = key ? detId(ctx.userId, key, "note") : randomUUID();
    const cardId = (b: OcclusionBox) =>
      key ? detId(ctx.userId, key, `card${b.id}`) : randomUUID();
    if (key) {
      const { rows } = await ctx.db.query<{ data: Row }>(
        "SELECT data FROM changes WHERE user_id = $1 AND tbl = 'notes' AND id = $2 AND NOT deleted",
        [ctx.userId, noteId]
      );
      const prior = rows[0]?.data;
      if (prior) {
        if (prior.mcpRequest !== request)
          throw new ImageError(
            "idempotency_conflict",
            `idempotency_key "${key}" was already used with a different picture, areas or deck.`,
            "Use a new key for different content, or repeat the exact same request."
          );
        const again = (prior.content.boxes as OcclusionBox[]).map((b) => ({
          card_id: detId(ctx.userId, key, `card${b.id}`),
          area_id: b.id,
          ...(b.label ? { label: b.label } : {}),
        }));
        return {
          replayed: true,
          cards_created: 0,
          note_id: noteId,
          cards: again,
          card_ids: again.map((c) => c.card_id),
        };
      }
    }

    let image: string;
    let storage: "r2" | "inline" | "link";
    if (pic.kind === "link") {
      image = pic.url;
      storage = "link";
    } else {
      const bytes =
        pic.kind === "bytes"
          ? { data: pic.asset.data, kind: pic.asset.kind }
          : { data: pic.bytes, kind: pic.imgKind };
      ({ image, storage } = await noteImageFor(ctx, bytes));
    }
    const content = {
      type: "imageOcclusion",
      image,
      boxes,
      hideAll,
      ...(header ? { header } : {}),
    };
    const problem = validateImageOcclusion(content);
    if (problem) throw new ImageError("invalid_occlusion", problem);

    const when = new Date(ctx.now);
    const rows: WriteRow[] = [
      {
        tbl: "notes",
        id: noteId,
        data: {
          id: noteId,
          deck: deck.id,
          creationDate: when,
          linkedNotes: [],
          content,
          sortField: header ?? "Image occlusion",
          ...(tags.length ? { tags } : {}),
          ...(key ? { mcpRequest: request } : {}),
        },
      },
    ];
    const cards = boxes.map((b) => ({
      card_id: cardId(b),
      area_id: b.id,
      ...(b.label ? { label: b.label } : {}),
    }));
    for (const c of cards)
      rows.push({
        tbl: "cards",
        id: c.card_id,
        data: {
          id: c.card_id,
          deck: deck.id,
          note: noteId,
          creationDate: when,
          model: createEmptyCard(when),
          content: { type: "imageOcclusion", occlusionNumber: c.area_id },
        },
      });
    rows.push({
      tbl: "decks",
      id: deck.id,
      data: {
        ...deck,
        notes: [...(deck.notes ?? []), noteId],
        cards: [...(deck.cards ?? []), ...cards.map((c) => c.card_id)],
      },
    });
    try {
      await putRows(ctx, rows);
    } catch (e) {
      throw new ImageError(
        "save_failed",
        `the cards could not be saved (${(e as Error).message}); nothing was created.`,
        "Retry with the same idempotency_key."
      );
    }
    return {
      replayed: false,
      cards_created: cards.length,
      note_id: noteId,
      cards,
      card_ids: cards.map((c) => c.card_id),
      image_storage: storage,
      next: "Call get_card_image with a card_id to check the picture and the hidden area.",
    };
  },
};

const get_capabilities: Tool = {
  name: "get_capabilities",
  description:
    "What this Skola server can do right now: card types, picture formats and limits, how pictures are stored, the image-occlusion workflow and the coordinate system. Call it first if you are unsure what a tool accepts.",
  inputSchema: { type: "object", properties: {} },
  async run() {
    const stored = mediaEnabled();
    return {
      card_types: [
        "basic",
        "cloze",
        "multiple_choice",
        "list",
        "image_occlusion",
      ],
      image: {
        formats: ["png", "jpeg", "webp", "gif"],
        inputs: [
          "image_asset_id",
          "image_base64 (data URL or base64)",
          "image (file reference with download_url)",
          "image_url (public https link)",
        ],
        max_upload_bytes: ASSET_MAX_BYTES,
        max_request_bytes_on_vercel: 4_000_000,
        max_total_uploaded_bytes: ASSET_USER_BYTES,
        max_inline_card_bytes: MAX_IMAGE_BYTES,
        card_picture_storage: stored
          ? "r2 (up to 15 MB per picture)"
          : "inline in the card (up to 400 KB per picture)",
        max_areas_per_picture: IO_MAX_BOXES,
      },
      coordinates:
        "Fractions of the picture (0 to 1) from its top-left corner: x, y is the corner, w, h the size, x+w and y+h at most 1. Independent of pixel size, so resizing never moves an area.",
      image_occlusion_workflow: [
        "upload_image_asset -> image_asset_id",
        "preview_image_occlusion (optional) -> check areas",
        "create_image_occlusion_cards with idempotency_key -> card_ids",
        "get_card_image -> verify the picture and the hidden area",
      ],
      errors:
        "Failures start with a code in brackets, for example [invalid_areas], then what is wrong and what to do.",
    };
  },
};

export const OCCLUSION_TOOLS: Tool[] = [
  get_capabilities,
  upload_image_asset,
  get_image_asset,
  preview_image_occlusion,
  create_image_occlusion_cards,
];
