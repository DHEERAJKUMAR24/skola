import type { Db } from "./db";
import type { Tool } from "./mcpData";
import { EVIDENCE_TOOLS } from "./mcpEvidence";
import { MANAGE_TOOLS } from "./mcpManage";

/**
 * Server-only data (edit history, learning objectives) has no local copy in the app, so the app
 * reaches it through API routes. They run the very same tool functions the MCP server runs, so
 * validation, limits and confirmation tokens cannot drift apart: the app is one more client.
 */
export const HISTORY_OPS = {
  history: "card_history",
  restore: "restore_card_version",
} as const;

export const OBJECTIVE_OPS = {
  list: "list_objectives",
  get: "get_objective",
  create: "create_objective",
  update: "update_objective",
  delete: "delete_objective",
  assess: "record_assessment",
  link: "link_cards",
} as const;

type OpMap = Record<string, string>;
const ALL: Tool[] = [...MANAGE_TOOLS, ...EVIDENCE_TOOLS];

export interface AppResult {
  status: number;
  body: Record<string, unknown> | unknown[];
}

const STATUS_BY_CODE: Record<string, number> = {
  card_not_found: 404,
  deck_not_found: 404,
  objective_not_found: 404,
  version_not_found: 404,
};

/** Runs one op of `ops` as `userId`. Tool errors look like `[code] message` and become a 4xx. */
export async function runAppOp(
  db: Db,
  userId: string,
  ops: OpMap,
  input: unknown,
  now = Date.now()
): Promise<AppResult> {
  const { op, ...args } = (
    input && typeof input === "object" ? input : {}
  ) as Record<string, unknown>;
  const name = typeof op === "string" ? ops[op] : undefined;
  const tool = ALL.find((t) => t.name === name);
  if (!tool) return { status: 400, body: { error: "Unknown op" } };
  try {
    const out = await tool.run({ db, userId, now }, args);
    return {
      status: 200,
      body: Array.isArray(out)
        ? { items: out }
        : (out as Record<string, never>),
    };
  } catch (e) {
    const message = (e as Error).message ?? "";
    const code = /^\[(\w+)\]/.exec(message)?.[1];
    if (code)
      return {
        status: STATUS_BY_CODE[code] ?? 400,
        body: { error: message.replace(/^\[\w+\]\s*/, ""), code },
      };
    console.error(e);
    return { status: 500, body: { error: "Something went wrong" } };
  }
}
