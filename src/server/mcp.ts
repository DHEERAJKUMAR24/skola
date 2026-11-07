import type { Db } from "./db";
import { get_card_image, isContentResult } from "./mcpCardImage";
import {
  type Row,
  type Tool,
  cardView,
  ms,
  noteText,
  num,
  snapshot,
  str,
  studyCards,
  studyable,
} from "./mcpData";
import { deckPathOf } from "./mcpDecks";
import { DUPLICATE_TOOLS } from "./mcpDuplicates";
import { EVIDENCE_TOOLS } from "./mcpEvidence";
import { INSTRUCTION_TOOLS } from "./mcpInstructions";
import { MANAGE_TOOLS } from "./mcpManage";
import { MASTER_TOOLS } from "./mcpMaster";
import { OCCLUSION_TOOLS } from "./mcpOcclusion";
import {
  RpcError,
  SKILL_TOOLS,
  getPrompt,
  listPrompts,
  listResources,
  readResource,
  serverInstructions,
} from "./mcpSkills";
import { STUDY_TOOLS } from "./mcpStudy";
import { WRITE_TOOLS } from "./mcpWrite";

// ts-fsrs State enum values.
const NEW = 0;
const REVIEW = 2;

const READ_TOOLS: Tool[] = [
  get_card_image,
  {
    name: "list_decks",
    description: "List all decks with their path, card count and paused flag.",
    inputSchema: { type: "object", properties: {} },
    async run(ctx) {
      const { decks, cards } = await snapshot(ctx);
      const count = new Map<string, number>();
      for (const c of cards) count.set(c.deck, (count.get(c.deck) ?? 0) + 1);
      return decks.map((d) => ({
        id: d.id,
        path: deckPathOf(decks, d),
        cards: count.get(d.id) ?? 0,
        paused: d.priority === "paused",
      }));
    },
  },
  {
    name: "deck_stats",
    description:
      "Counts of new, learning, review and due cards for a deck and its sub-decks (all decks if no deck_id).",
    inputSchema: {
      type: "object",
      properties: { deck_id: { type: "string" } },
    },
    async run(ctx, a) {
      const { cards } = await snapshot(ctx, str(a, "deck_id"));
      const live = cards.filter((c) => studyable(c, ctx.now));
      return {
        total: cards.length,
        suspended: cards.filter((c) => c.suspended).length,
        new: live.filter((c) => c.model?.state === NEW).length,
        learning: live.filter(
          (c) => c.model?.state === 1 || c.model?.state === 3
        ).length,
        review: live.filter((c) => c.model?.state === REVIEW).length,
        due: live.filter(
          (c) => c.model?.state !== NEW && ms(c.model?.due) <= ctx.now
        ).length,
      };
    },
  },
  {
    name: "get_due_cards",
    description:
      "Cards due for review now (most overdue first), with their text. Optional deck_id and limit (default 20, max 100).",
    inputSchema: {
      type: "object",
      properties: { deck_id: { type: "string" }, limit: { type: "number" } },
    },
    async run(ctx, a) {
      const { cards, decks, notes } = await snapshot(ctx, str(a, "deck_id"));
      return studyCards(cards, decks, ctx.now)
        .filter((c) => c.model?.state !== NEW && ms(c.model?.due) <= ctx.now)
        .sort((x, y) => ms(x.model.due) - ms(y.model.due))
        .slice(0, num(a, "limit", 20, 100))
        .map((c) => cardView(c, notes));
    },
  },
  {
    name: "search_cards",
    description:
      "Find cards whose note text or tags contain the query (case-insensitive). Optional deck_id and limit (default 20, max 100).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        deck_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    async run(ctx, a) {
      const q = (str(a, "query") ?? "").toLowerCase();
      if (!q) throw new Error("query is required");
      const { cards, notes } = await snapshot(ctx, str(a, "deck_id"));
      return cards
        .filter((c) => {
          const n = notes.get(c.note);
          return (
            n &&
            `${noteText(n)} ${(n.tags ?? []).join(" ")}`
              .toLowerCase()
              .includes(q)
          );
        })
        .slice(0, num(a, "limit", 20, 100))
        .map((c) => cardView(c, notes));
    },
  },
  {
    name: "find_leeches",
    description:
      "Cards that keep lapsing: tagged 'leech' or with at least `min_lapses` lapses (default 8).",
    inputSchema: {
      type: "object",
      properties: {
        deck_id: { type: "string" },
        min_lapses: { type: "number" },
      },
    },
    async run(ctx, a) {
      const min = num(a, "min_lapses", 8, 1000);
      const { cards, notes } = await snapshot(ctx, str(a, "deck_id"));
      return cards
        .filter(
          (c) =>
            (c.model?.lapses ?? 0) >= min ||
            (notes.get(c.note)?.tags ?? []).includes("leech")
        )
        .sort((x, y) => (y.model?.lapses ?? 0) - (x.model?.lapses ?? 0))
        .map((c) => cardView(c, notes));
    },
  },
  {
    name: "find_duplicates",
    description:
      "Groups of notes with identical text (ignoring case, markup and spacing). For the same meaning in other words use find_similar_cards.",
    inputSchema: {
      type: "object",
      properties: { deck_id: { type: "string" } },
    },
    async run(ctx, a) {
      const { cards, notes } = await snapshot(ctx, str(a, "deck_id"));
      const groups = new Map<string, Row[]>();
      for (const id of new Set(cards.map((c) => c.note))) {
        const n = notes.get(id);
        if (!n) continue;
        const key = noteText(n).toLowerCase().replace(/\s+/g, " ");
        if (key) groups.set(key, [...(groups.get(key) ?? []), n]);
      }
      return [...groups.values()]
        .filter((g) => g.length > 1)
        .map((g) => ({
          text: noteText(g[0]),
          notes: g.map((n) => ({ id: n.id, deck: n.deck })),
        }));
    },
  },
];

export const TOOLS: Tool[] = [
  ...READ_TOOLS,
  ...DUPLICATE_TOOLS,
  ...SKILL_TOOLS,
  ...WRITE_TOOLS,
  ...OCCLUSION_TOOLS,
  ...STUDY_TOOLS,
  ...MANAGE_TOOLS,
  ...MASTER_TOOLS,
  ...EVIDENCE_TOOLS,
  ...INSTRUCTION_TOOLS,
];

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

/** Handles one JSON-RPC message; returns null for notifications (no reply). */
export async function handleRpc(
  db: Db,
  userId: string,
  msg: RpcRequest,
  /** Public origin; when given, the server advertises its icon from it. */
  base?: string
): Promise<object | null> {
  if (msg.id === undefined) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code, message },
  });

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {}, resources: {}, prompts: {} },
        // `name` stays "skola": clients and installed skills key on it. `title` is what people see.
        serverInfo: {
          name: "skola",
          title: "Skola++",
          version: "0.1.0",
          ...(base && {
            icons: [
              {
                src: `${base}/logo512.png`,
                mimeType: "image/png",
                sizes: ["512x512"],
              },
              {
                src: `${base}/logo.svg`,
                mimeType: "image/svg+xml",
                sizes: ["any"],
              },
            ],
          }),
        },
        instructions: await serverInstructions(db, userId),
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: TOOLS.map(
          ({ name, description, inputSchema, write, destructive, meta }) => ({
            name,
            description,
            inputSchema,
            ...(meta ? { _meta: meta } : {}),
            annotations: write
              ? { readOnlyHint: false, destructiveHint: !!destructive }
              : { readOnlyHint: true },
          })
        ),
      });
    case "resources/list":
      return ok({ resources: await listResources(db, userId) });
    case "resources/templates/list":
      return ok({ resourceTemplates: [] });
    case "resources/read":
      try {
        return ok({
          contents: [
            await readResource(db, userId, String(msg.params?.uri ?? "")),
          ],
        });
      } catch (e) {
        if (e instanceof RpcError) return fail(e.code, e.message);
        throw e;
      }
    case "prompts/list":
      return ok({ prompts: await listPrompts(db, userId) });
    case "prompts/get":
      try {
        return ok(await getPrompt(db, userId, String(msg.params?.name ?? "")));
      } catch (e) {
        if (e instanceof RpcError) return fail(e.code, e.message);
        throw e;
      }
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const out = await tool.run(
          { db, userId, now: Date.now() },
          msg.params?.arguments ?? {}
        );
        if (isContentResult(out)) return ok({ content: out.__content });
        const text = typeof out === "string" ? out : JSON.stringify(out);
        return ok({ content: [{ type: "text", text }] });
      } catch (e) {
        return ok({
          isError: true,
          content: [{ type: "text", text: (e as Error).message }],
        });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}
