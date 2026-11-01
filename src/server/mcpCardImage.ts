import { type Row, type Tool, str } from "./mcpData";
import { MEDIA_REF, presignRead } from "./media";

/** A tool result made of ready MCP content blocks instead of JSON text. */
export interface ContentResult {
  __content: unknown[];
}

export const isContentResult = (v: unknown): v is ContentResult =>
  !!v && typeof v === "object" && Array.isArray((v as ContentResult).__content);

async function one(
  ctx: Parameters<Tool["run"]>[0],
  tbl: string,
  id: string
): Promise<Row | undefined> {
  const { rows } = await ctx.db.query<{ data: Row }>(
    "SELECT data FROM changes WHERE user_id = $1 AND tbl = $2 AND id = $3 AND NOT deleted",
    [ctx.userId, tbl, id]
  );
  return rows[0]?.data;
}

export const get_card_image: Tool = {
  name: "get_card_image",
  description:
    "Get the picture of an image-occlusion card as image_url (a link you can open or render; a stored picture gets a link valid for an hour), with its header, whether all areas are hidden, which area this card asks about (active_area), and every area as fractions of the picture (x, y from the top left, w, h the size). Use it before quizzing or editing such a card.",
  inputSchema: {
    type: "object",
    properties: { card_id: { type: "string" } },
    required: ["card_id"],
  },
  async run(ctx, a) {
    const card = await one(ctx, "cards", str(a, "card_id") ?? "");
    if (!card) throw new Error("card not found");
    const note = await one(ctx, "notes", card.note);
    const c = note?.content;
    if (c?.type !== "imageOcclusion" || typeof c.image !== "string")
      throw new Error("this card has no picture");
    const info = {
      header: c.header,
      hide_all: c.hideAll,
      active_area: card.content?.occlusionNumber,
      areas: c.boxes,
    };
    // A linked picture is returned as its link; the client can render it from there.
    if (/^https:\/\//.test(c.image)) return { ...info, image_url: c.image };
    // A stored picture gets a link that works for an hour.
    const ref = MEDIA_REF.exec(c.image);
    if (ref) {
      const link = await presignRead(ctx.db, ctx.userId, ref[1]);
      return {
        ...info,
        image_url: link.url,
        image_url_expires_at: link.expiresAt,
      };
    }
    const m = /^data:(image\/[a-z]+);base64,([\s\S]+)$/.exec(c.image);
    if (!m) throw new Error("the picture could not be read");
    const result: ContentResult = {
      __content: [
        {
          type: "text",
          text: JSON.stringify(info),
        },
        { type: "image", data: m[2], mimeType: m[1] },
      ],
    };
    return result;
  },
};
