import { createHash } from "node:crypto";
import type { Db } from "./db";
import { SEED_SKILLS } from "./skillSeed";

/** Owner of the shared default skills. Users' own skills use their user id. */
export const DEFAULT_OWNER = "";

export const MAX_SKILLS = 20;
export const MAX_FILES = 30;
export const MAX_FILE_BYTES = 100_000;
export const MAX_OWNER_BYTES = 1_000_000;
const HISTORY_KEEP = 20;

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Names that would clash with fixed URLs under /skills.
const RESERVED = new Set(["edit", "api"]);
const PATH =
  /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,2}$/;
const EXT = /\.(md|txt|json)$/;

export class SkillError extends Error {}

export interface SkillFile {
  owner: string;
  skill: string;
  path: string;
  content: string;
  updatedAt: number;
}

export interface SkillSummary {
  name: string;
  description: string;
  /** "default" is the shared skill, "custom" is one of the user's own (possibly overriding a default). */
  source: "default" | "custom";
  updatedAt: number;
}

/**
 * Reads the YAML header of a SKILL.md. Only what the Agent Skills spec requires is parsed:
 * `key: value` lines, with `>` / `|` blocks folded into one line.
 */
export function parseFrontmatter(md: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(md);
  if (!m) throw new SkillError("SKILL.md must start with a --- YAML header");
  const out: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]))
        parts.push(lines[++i].trim());
      value = parts.join(" ");
    }
    out[kv[1]] = value.replace(/^(["'])([\s\S]*)\1$/, "$2");
  }
  return out;
}

export function validateSkillName(skill: string) {
  if (!NAME.test(skill) || skill.length > 64 || RESERVED.has(skill))
    throw new SkillError(
      "Skill names use lowercase letters, numbers and single hyphens (max 64)"
    );
}

export function validatePath(path: string) {
  if (!PATH.test(path) || path.length > 200 || path.includes(".."))
    throw new SkillError("Invalid file path");
  if (path !== "SKILL.md" && !EXT.test(path))
    throw new SkillError("Files must end in .md, .txt or .json");
  // The entry file is exactly SKILL.md, not skill.md or nested copies.
  if (/skill\.md$/i.test(path) && path !== "SKILL.md")
    throw new SkillError("The entry file must be named SKILL.md at the top");
}

/** Spec limits: name matches the folder, description is 1 to 1024 characters. */
export function validateSkillMd(skill: string, content: string) {
  const fm = parseFrontmatter(content);
  if (fm.name !== skill)
    throw new SkillError(`name in the header must be "${skill}"`);
  if (!fm.description || fm.description.length > 1024)
    throw new SkillError("description must be 1 to 1024 characters");
}

export const etagOf = (content: string) =>
  `"${createHash("sha256").update(content).digest("hex").slice(0, 16)}"`;

let seeded = false;

/** Puts the built-in skill in an empty table once per process. Never overwrites edits. */
export async function ensureSeed(db: Db) {
  if (seeded) return;
  // History counts too: an admin who deleted every default must not get the built-in one back.
  const { rows } = await db.query<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM skill_files WHERE owner = $1) + (SELECT COUNT(*) FROM skill_history WHERE owner = $1) AS n",
    [DEFAULT_OWNER]
  );
  if (Number(rows[0].n) === 0) {
    const now = Date.now();
    for (const [skill, files] of Object.entries(SEED_SKILLS))
      for (const [path, content] of Object.entries(files))
        await db.query(
          `INSERT INTO skill_files (owner, skill, path, content, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, 'seed') ON CONFLICT DO NOTHING`,
          [DEFAULT_OWNER, skill, path, content, now]
        );
  }
  seeded = true;
}

/** Test helper: lets a fresh in-memory database be seeded again. */
export const resetSeedFlag = () => {
  seeded = false;
};

type Raw = {
  owner: string;
  skill: string;
  path: string;
  content: string;
  updated_at: string;
};

const toFile = (r: Raw): SkillFile => ({
  owner: r.owner,
  skill: r.skill,
  path: r.path,
  content: r.content,
  updatedAt: Number(r.updated_at),
});

/** Every file of one owner's skills (DEFAULT_OWNER for the shared set). */
export async function ownerFiles(
  db: Db,
  owner: string,
  skill?: string
): Promise<SkillFile[]> {
  if (owner === DEFAULT_OWNER) await ensureSeed(db);
  const { rows } = await db.query<Raw>(
    `SELECT owner, skill, path, content, updated_at FROM skill_files
     WHERE owner = $1 AND ($2::text IS NULL OR skill = $2)
     ORDER BY skill, (path <> 'SKILL.md'), path`,
    [owner, skill ?? null]
  );
  return rows.map(toFile);
}

/**
 * What a user sees: the defaults, except that a skill the user has made with the same name
 * replaces that default completely. Without a user, only the defaults.
 */
export async function effectiveFiles(
  db: Db,
  userId: string | null
): Promise<SkillFile[]> {
  const defaults = await ownerFiles(db, DEFAULT_OWNER);
  if (!userId) return defaults;
  const mine = await ownerFiles(db, userId);
  const overridden = new Set(mine.map((f) => f.skill));
  return [...defaults.filter((f) => !overridden.has(f.skill)), ...mine].sort(
    (a, b) =>
      a.skill.localeCompare(b.skill) ||
      Number(a.path !== "SKILL.md") - Number(b.path !== "SKILL.md") ||
      a.path.localeCompare(b.path)
  );
}

export async function resolveFile(
  db: Db,
  userId: string | null,
  skill: string,
  path: string
) {
  return (
    (await effectiveFiles(db, userId)).find(
      (f) => f.skill === skill && f.path === path
    ) ?? null
  );
}

function safeDescription(md: string) {
  try {
    return parseFrontmatter(md).description ?? "";
  } catch {
    return "";
  }
}

export async function listSkills(
  db: Db,
  userId: string | null
): Promise<SkillSummary[]> {
  return (await effectiveFiles(db, userId))
    .filter((f) => f.path === "SKILL.md")
    .map((f) => ({
      name: f.skill,
      description: safeDescription(f.content),
      source: f.owner === DEFAULT_OWNER ? "default" : "custom",
      updatedAt: f.updatedAt,
    }));
}

type Q = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function remember(
  q: Q,
  owner: string,
  skill: string,
  path: string,
  content: string,
  by: string
) {
  await q(
    "INSERT INTO skill_history (owner, skill, path, content, saved_at, saved_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [owner, skill, path, content, Date.now(), by]
  );
  await q(
    `DELETE FROM skill_history WHERE owner = $1 AND skill = $2 AND path = $3
     AND id NOT IN (SELECT id FROM skill_history WHERE owner = $1 AND skill = $2 AND path = $3
                    ORDER BY id DESC LIMIT ${HISTORY_KEEP})`,
    [owner, skill, path]
  );
}

/** Creates or replaces a file. The old text goes to history first. */
export async function saveFile(
  db: Db,
  owner: string,
  skill: string,
  path: string,
  content: string,
  by: string
) {
  validateSkillName(skill);
  validatePath(path);
  if (typeof content !== "string" || !content.trim())
    throw new SkillError("Content cannot be empty");
  if (Buffer.byteLength(content) > MAX_FILE_BYTES)
    throw new SkillError(`Files are limited to ${MAX_FILE_BYTES} bytes`);
  if (path === "SKILL.md") validateSkillMd(skill, content);

  if (owner === DEFAULT_OWNER) await ensureSeed(db);
  await db.transaction(async (q) => {
    // Serialises one owner's writes so the limits below cannot be raced past.
    await q("SELECT pg_advisory_xact_lock(hashtext($1))", [`skills:${owner}`]);
    const { rows: cur } = await q<{ content: string }>(
      "SELECT content FROM skill_files WHERE owner = $1 AND skill = $2 AND path = $3",
      [owner, skill, path]
    );
    if (!cur[0]) {
      const { rows: n } = await q<{
        files: number;
        skills: number;
        bytes: string;
      }>(
        `SELECT COUNT(*) FILTER (WHERE skill = $2)::int AS files,
                COUNT(DISTINCT skill)::int AS skills,
                COALESCE(SUM(octet_length(content)), 0) AS bytes
         FROM skill_files WHERE owner = $1`,
        [owner, skill]
      );
      if (n[0].files === 0 && path !== "SKILL.md")
        throw new SkillError("Create the skill's SKILL.md first");
      if (n[0].files === 0 && n[0].skills >= MAX_SKILLS)
        throw new SkillError(`At most ${MAX_SKILLS} skills`);
      if (n[0].files >= MAX_FILES)
        throw new SkillError(`At most ${MAX_FILES} files per skill`);
      if (Number(n[0].bytes) + Buffer.byteLength(content) > MAX_OWNER_BYTES)
        throw new SkillError("Total skill storage limit reached");
    } else if (cur[0].content === content) {
      return;
    } else {
      await remember(q, owner, skill, path, cur[0].content, by);
    }
    await q(
      `INSERT INTO skill_files (owner, skill, path, content, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (owner, skill, path) DO UPDATE SET
         content = EXCLUDED.content, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [owner, skill, path, content, Date.now(), by]
    );
  });
}

async function removeRows(
  db: Db,
  owner: string,
  skill: string,
  path: string | null,
  by: string
) {
  if (owner === DEFAULT_OWNER) await ensureSeed(db);
  const removed = await db.transaction(async (q) => {
    const { rows } = await q<{ path: string; content: string }>(
      `SELECT path, content FROM skill_files
       WHERE owner = $1 AND skill = $2 AND ($3::text IS NULL OR path = $3)`,
      [owner, skill, path]
    );
    for (const r of rows)
      await remember(q, owner, skill, r.path, r.content, by);
    await q(
      "DELETE FROM skill_files WHERE owner = $1 AND skill = $2 AND ($3::text IS NULL OR path = $3)",
      [owner, skill, path]
    );
    return rows.length;
  });
  if (!removed) throw new SkillError("Nothing to delete");
}

/** Removes one reference file. The entry file goes only with the whole skill. */
export async function deleteFile(
  db: Db,
  owner: string,
  skill: string,
  path: string,
  by: string
) {
  if (path === "SKILL.md")
    throw new SkillError("Delete the whole skill instead of its SKILL.md");
  await removeRows(db, owner, skill, path, by);
}

export async function deleteSkill(
  db: Db,
  owner: string,
  skill: string,
  by: string
) {
  await removeRows(db, owner, skill, null, by);
}

export async function fileHistory(
  db: Db,
  owner: string,
  skill: string,
  path: string,
  limit = HISTORY_KEEP
) {
  const { rows } = await db.query<{
    id: string;
    content: string;
    saved_at: string;
    saved_by: string | null;
  }>(
    `SELECT id, content, saved_at, saved_by FROM skill_history
     WHERE owner = $1 AND skill = $2 AND path = $3 ORDER BY id DESC LIMIT $4`,
    [owner, skill, path, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    content: r.content,
    savedAt: Number(r.saved_at),
    savedBy: r.saved_by,
  }));
}

/** Puts an earlier version back (as a new save, so the restore itself can be undone). */
export async function restoreVersion(
  db: Db,
  owner: string,
  skill: string,
  path: string,
  versionId: number,
  by: string
) {
  const { rows } = await db.query<{ content: string }>(
    "SELECT content FROM skill_history WHERE id = $1 AND owner = $2 AND skill = $3 AND path = $4",
    [versionId, owner, skill, path]
  );
  if (!rows[0]) throw new SkillError("Version not found");
  await saveFile(db, owner, skill, path, rows[0].content, by);
}

/**
 * Copies a default skill into the user's own set so they can customise it. A different `as`
 * name renames it, which rewrites the header's name line.
 */
export async function copyDefaultSkill(
  db: Db,
  owner: string,
  from: string,
  as: string,
  by: string
) {
  const source = await ownerFiles(db, DEFAULT_OWNER, from);
  if (!source.length) throw new SkillError(`No default skill named ${from}`);
  if ((await ownerFiles(db, owner, as)).length)
    throw new SkillError(`You already have a skill named ${as}`);
  for (const f of source)
    await saveFile(
      db,
      owner,
      as,
      f.path,
      f.path === "SKILL.md" && as !== from
        ? f.content.replace(/^(name:\s*).*$/m, `$1${as}`)
        : f.content,
      by
    );
}

/** Builds a SKILL.md from a name, description and body. */
export function composeSkillMd(
  name: string,
  description: string,
  body: string
) {
  const desc = description.replace(/\s+/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body.trim()}\n`;
}

/** Who may edit the shared default skills: the comma-separated emails in SKILL_ADMINS. Unset means nobody. */
export function isSkillAdmin(email: string | null | undefined) {
  if (!email) return false;
  return (process.env.SKILL_ADMINS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
