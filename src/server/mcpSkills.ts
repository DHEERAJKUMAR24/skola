import type { Db } from "./db";
import { type Args, type Ctx, type Tool, str } from "./mcpData";
import {
  DEFAULT_OWNER,
  SkillError,
  composeSkillMd,
  copyDefaultSkill,
  deleteFile,
  deleteSkill,
  effectiveFiles,
  fileHistory,
  isSkillAdmin,
  listSkills,
  resolveFile,
  restoreVersion,
  saveFile,
} from "./skills";
import { getUserEmail } from "./users";

const URI = /^skill:\/\/([^/]+)\/(.+)$/;
const mime = (path: string) =>
  path.endsWith(".json") ? "application/json" : "text/markdown";

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
  }
}

/** Short on purpose: clients put this in context at the start of every session. */
export async function serverInstructions(db: Db, userId: string) {
  const names = (await listSkills(db, userId)).map((s) => s.name).join(", ");
  return [
    "Skola is the user's spaced-repetition flashcard app. These tools read and change their real decks.",
    `Before using the card tools, read the agent skill: call get_skill with name "skola" (available skills: ${names || "none"}).`,
    "Show a draft before adding more than a few cards, and never call grade_card unless the user has answered the card.",
  ].join(" ");
}

/**
 * Which set a write goes to: the caller's own skills, or the shared defaults, which only an
 * admin may change.
 */
async function target(ctx: Ctx, a: Args) {
  const scope = str(a, "scope") ?? "mine";
  if (scope === "mine") return ctx.userId;
  if (scope !== "default") throw new Error('scope must be "mine" or "default"');
  if (!isSkillAdmin(await getUserEmail(ctx.db, ctx.userId)))
    throw new Error("Only an admin can change the default skills");
  return DEFAULT_OWNER;
}

const name = (a: Args) => {
  const n = str(a, "name");
  if (!n) throw new Error("name is required");
  return n;
};
const pathOf = (a: Args) => str(a, "path") ?? "SKILL.md";

/** Skill failures are the caller's to fix; anything else is a real error. */
async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SkillError) throw new Error(e.message);
    throw e;
  }
}

const scopeProp = {
  type: "string",
  enum: ["mine", "default"],
  description:
    'Whose skill: "mine" (default) is your own; "default" is the shared set and needs an admin.',
};

const get_skill: Tool = {
  name: "get_skill",
  description:
    "Read an agent skill (how to write cards, quiz the user, tidy decks). With no arguments, lists the skills you can use (the shared defaults plus your own) with their files. With name (and optional path, default SKILL.md), returns that file.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, path: { type: "string" } },
  },
  async run(ctx, a) {
    const n = str(a, "name");
    if (!n) {
      const files = await effectiveFiles(ctx.db, ctx.userId);
      return (await listSkills(ctx.db, ctx.userId)).map((s) => ({
        ...s,
        files: files.filter((f) => f.skill === s.name).map((f) => f.path),
      }));
    }
    const file = await resolveFile(ctx.db, ctx.userId, n, pathOf(a));
    if (!file) throw new Error(`No file ${pathOf(a)} in skill ${n}`);
    return file.content;
  },
};

const create_skill: Tool = {
  name: "create_skill",
  write: true,
  description:
    "Create one of your own skills. Give name, description and body (the instructions), or copy_from to start from a default skill, for example to customise it. A skill of yours replaces a default of the same name for you only, completely, so copy before you customise. Name: lowercase letters, numbers, hyphens.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: {
        type: "string",
        description:
          "When the assistant should use this skill and what it does (max 1024 chars)",
      },
      body: { type: "string", description: "Markdown instructions" },
      copy_from: { type: "string", description: "Name of a default skill" },
    },
    required: ["name"],
  },
  run: (ctx, a) =>
    guard(async () => {
      const n = name(a);
      const from = str(a, "copy_from");
      if (from) await copyDefaultSkill(ctx.db, ctx.userId, from, n, ctx.userId);
      else {
        const description = str(a, "description");
        const body = str(a, "body");
        if (!description || !body)
          throw new Error(
            "description and body are required without copy_from"
          );
        await saveFile(
          ctx.db,
          ctx.userId,
          n,
          "SKILL.md",
          composeSkillMd(n, description, body),
          ctx.userId
        );
      }
      return { created: n };
    }),
};

const update_skill_file: Tool = {
  name: "update_skill_file",
  write: true,
  description:
    "Create or replace one file of a skill with the full new content (path defaults to SKILL.md; other files go under references/, e.g. references/notes.md; .md, .txt or .json only). SKILL.md must begin with a --- header holding name (matching the skill) and description. The previous text is kept in history.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
      scope: scopeProp,
    },
    required: ["name", "content"],
  },
  run: (ctx, a) =>
    guard(async () => {
      const owner = await target(ctx, a);
      const content = str(a, "content");
      if (!content) throw new Error("content is required");
      await saveFile(ctx.db, owner, name(a), pathOf(a), content, ctx.userId);
      return { saved: `${name(a)}/${pathOf(a)}` };
    }),
};

const delete_skill_file: Tool = {
  name: "delete_skill_file",
  write: true,
  destructive: true,
  description:
    "Delete one reference file from a skill (not SKILL.md; use delete_skill for that). The text stays in history and can be restored.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      path: { type: "string" },
      scope: scopeProp,
    },
    required: ["name", "path"],
  },
  run: (ctx, a) =>
    guard(async () => {
      const owner = await target(ctx, a);
      await deleteFile(ctx.db, owner, name(a), pathOf(a), ctx.userId);
      return { deleted: `${name(a)}/${pathOf(a)}` };
    }),
};

const delete_skill: Tool = {
  name: "delete_skill",
  write: true,
  destructive: true,
  description:
    "Delete one of your own skills with all its files. If it replaced a default of the same name, the default is back in effect (a reset). Files stay in history and can be restored.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, scope: scopeProp },
    required: ["name"],
  },
  run: (ctx, a) =>
    guard(async () => {
      const owner = await target(ctx, a);
      await deleteSkill(ctx.db, owner, name(a), ctx.userId);
      return { deleted: name(a) };
    }),
};

const skill_history: Tool = {
  name: "skill_history",
  description:
    "List earlier versions of a skill file, newest first, with an id for restore_skill_file and a short preview.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      path: { type: "string" },
      scope: scopeProp,
    },
    required: ["name"],
  },
  run: (ctx, a) =>
    guard(async () => {
      const owner = await target(ctx, a);
      return (await fileHistory(ctx.db, owner, name(a), pathOf(a))).map(
        (h) => ({
          version_id: h.id,
          saved_at: h.savedAt,
          preview: h.content.slice(0, 200),
        })
      );
    }),
};

const restore_skill_file: Tool = {
  name: "restore_skill_file",
  write: true,
  description:
    "Put an earlier version of a skill file back, using a version_id from skill_history. The current text goes to history, so a restore can be undone.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      path: { type: "string" },
      version_id: { type: "integer" },
      scope: scopeProp,
    },
    required: ["name", "version_id"],
  },
  run: (ctx, a) =>
    guard(async () => {
      const owner = await target(ctx, a);
      await restoreVersion(
        ctx.db,
        owner,
        name(a),
        pathOf(a),
        Number(a.version_id),
        ctx.userId
      );
      return { restored: `${name(a)}/${pathOf(a)}` };
    }),
};

export const SKILL_TOOLS: Tool[] = [
  get_skill,
  create_skill,
  update_skill_file,
  delete_skill_file,
  delete_skill,
  skill_history,
  restore_skill_file,
];

export async function listResources(db: Db, userId: string) {
  const files = await effectiveFiles(db, userId);
  return [
    {
      uri: "skill://index.json",
      name: "Skill index",
      mimeType: "application/json",
    },
    ...files.map((f) => ({
      uri: `skill://${f.skill}/${f.path}`,
      name: `${f.skill}/${f.path}`,
      mimeType: mime(f.path),
    })),
  ];
}

export async function readResource(db: Db, userId: string, uri: string) {
  if (uri === "skill://index.json") {
    const skills = (await listSkills(db, userId)).map((s) => ({
      name: s.name,
      description: s.description,
      uri: `skill://${s.name}/SKILL.md`,
    }));
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify({ skills }),
    };
  }
  const m = URI.exec(uri);
  const file = m && (await resolveFile(db, userId, m[1], m[2]));
  if (!file) throw new RpcError(-32002, `Resource not found: ${uri}`);
  return { uri, mimeType: mime(file.path), text: file.content };
}

/** One prompt per skill; picking it puts the SKILL.md in the conversation. */
export async function listPrompts(db: Db, userId: string) {
  return (await listSkills(db, userId)).map((s) => ({
    name: s.name,
    description: s.description,
  }));
}

export async function getPrompt(db: Db, userId: string, promptName: string) {
  const file = await resolveFile(db, userId, promptName, "SKILL.md");
  if (!file) throw new RpcError(-32602, `Unknown prompt: ${promptName}`);
  return {
    description: `The ${promptName} agent skill`,
    messages: [{ role: "user", content: { type: "text", text: file.content } }],
  };
}
