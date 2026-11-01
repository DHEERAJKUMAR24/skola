// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import { productText, skillText } from "./skillText";
import {
  DEFAULT_OWNER,
  MAX_FILES,
  deleteSkill,
  effectiveFiles,
  etagOf,
  ownerFiles,
  parseFrontmatter,
  resetSeedFlag,
  saveFile,
} from "./skills";
import { crc32, zip } from "./zip";

let db: Db;
const migrate = (f: string) =>
  fs.readFileSync(`supabase/migrations/${f}`, "utf8");

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(migrate("20261101000000_init.sql"));
  await pg.exec(migrate("20261102000000_skills.sql"));
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
  for (const [id, email] of [
    ["alice", "alice@example.com"],
    ["bob", "bob@example.com"],
    ["boss", "boss@example.com"],
  ])
    await db.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1,$2,'x',1)",
      [id, email]
    );
  process.env.SKILL_ADMINS = "Boss@Example.com";
});

const rpc = async (user: string, method: string, params: object = {}) =>
  (await handleRpc(db, user, { id: 1, method, params })) as any;
const call = async (user: string, name: string, args: object = {}) => {
  const r = await rpc(user, "tools/call", { name, arguments: args });
  const text = r.result.content[0].text;
  if (r.result.isError) return { error: text };
  try {
    return JSON.parse(text);
  } catch {
    return text; // get_skill returns raw markdown
  }
};

it("seeds the default skill once and exposes it to everyone", async () => {
  const list = await call("alice", "get_skill");
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ name: "skola", source: "default" });
  expect(list[0].files).toContain("references/quizzing.md");
  resetSeedFlag();
  expect(await call("bob", "get_skill")).toHaveLength(1); // no duplicate seed
  const md = await call("alice", "get_skill", { name: "skola" });
  expect(parseFrontmatter(md)).toMatchObject({ name: "skola" });
});

it("lets a user create, read, update and delete their own skill, privately", async () => {
  expect(
    await call("alice", "create_skill", {
      name: "my-notes",
      description: "Use when I ask about my notes",
      body: "# Notes\nBe brief.",
    })
  ).toEqual({ created: "my-notes" });
  const mine = (await call("alice", "get_skill")).map((s: any) => s.name);
  expect(mine).toEqual(["my-notes", "skola"]);
  expect((await call("bob", "get_skill")).map((s: any) => s.name)).toEqual([
    "skola",
  ]);
  expect(await call("bob", "get_skill", { name: "my-notes" })).toHaveProperty(
    "error"
  );

  await call("alice", "update_skill_file", {
    name: "my-notes",
    path: "references/extra.md",
    content: "More detail",
  });
  expect(
    await call("alice", "get_skill", {
      name: "my-notes",
      path: "references/extra.md",
    })
  ).toBe("More detail");
  await call("alice", "update_skill_file", {
    name: "my-notes",
    content: "---\nname: my-notes\ndescription: Updated\n---\nNew body",
  });
  expect((await call("alice", "get_skill"))[0].description).toBe("Updated");

  expect(
    await call("alice", "delete_skill_file", {
      name: "my-notes",
      path: "references/extra.md",
    })
  ).toEqual({ deleted: "my-notes/references/extra.md" });
  expect(await call("alice", "delete_skill", { name: "my-notes" })).toEqual({
    deleted: "my-notes",
  });
  expect((await call("alice", "get_skill")).map((s: any) => s.name)).toEqual([
    "skola",
  ]);
});

it("customises a default by copying it; deleting the copy resets to the default", async () => {
  await call("alice", "create_skill", { name: "skola", copy_from: "skola" });
  const edited = (await call("alice", "get_skill", { name: "skola" })).replace(
    "Rules that protect the user",
    "My own rules"
  );
  await call("alice", "update_skill_file", { name: "skola", content: edited });

  const aliceView = await call("alice", "get_skill");
  expect(aliceView[0]).toMatchObject({ name: "skola", source: "custom" });
  expect(aliceView[0].files).toContain("references/tools.md"); // copied along
  expect(await call("alice", "get_skill", { name: "skola" })).toContain(
    "My own rules"
  );
  // Nobody else, and the default itself, are untouched.
  expect(await call("bob", "get_skill", { name: "skola" })).toContain(
    "Rules that protect the user"
  );

  await call("alice", "delete_skill", { name: "skola" });
  expect(await call("alice", "get_skill", { name: "skola" })).toContain(
    "Rules that protect the user"
  );
  expect((await call("alice", "get_skill"))[0].source).toBe("default");
});

it("rejects bad names, headers, paths and oversize input", async () => {
  const bad = (args: object) => call("alice", "create_skill", args);
  expect(
    await bad({ name: "Bad Name", description: "d", body: "b" })
  ).toHaveProperty("error");
  expect(
    await bad({ name: "edit", description: "d", body: "b" })
  ).toHaveProperty("error");
  expect(await bad({ name: "ok", description: "d" })).toEqual({
    error: "description and body are required without copy_from",
  });
  const up = (args: object) => call("alice", "update_skill_file", args);
  expect(await up({ name: "x", content: "no header" })).toHaveProperty("error");
  expect(
    await up({ name: "x", content: "---\nname: other\ndescription: d\n---\nb" })
  ).toEqual({ error: 'name in the header must be "x"' });
  expect(
    await up({ name: "x", path: "references/a.md", content: "hi" })
  ).toEqual({
    error: "Create the skill's SKILL.md first",
  });
  expect(
    await up({ name: "skola", path: "../etc/passwd.md", content: "x" })
  ).toHaveProperty("error");
  expect(
    await up({ name: "skola", path: "references/a.exe", content: "x" })
  ).toHaveProperty("error");
  expect(
    await up({ name: "skola", path: "skill.md", content: "x" })
  ).toHaveProperty("error");
  expect(
    await up({
      name: "x",
      content: `---\nname: x\ndescription: ${"d".repeat(1025)}\n---\nb`,
    })
  ).toHaveProperty("error");
});

it("limits the number of files per skill", async () => {
  await call("bob", "create_skill", {
    name: "many",
    description: "d",
    body: "b",
  });
  for (let i = 1; i < MAX_FILES; i++)
    await saveFile(
      db,
      "bob",
      "many",
      `references/f${i}.md`,
      `file ${i}`,
      "bob"
    );
  expect(
    await call("bob", "update_skill_file", {
      name: "many",
      path: "references/over.md",
      content: "x",
    })
  ).toEqual({ error: `At most ${MAX_FILES} files per skill` });
});

it("keeps history and restores an earlier version", async () => {
  await call("bob", "create_skill", {
    name: "hist",
    description: "v1",
    body: "one",
  });
  const v2 = "---\nname: hist\ndescription: v2\n---\ntwo";
  await call("bob", "update_skill_file", { name: "hist", content: v2 });
  const h = await call("bob", "skill_history", { name: "hist" });
  expect(h).toHaveLength(1);
  expect(h[0].preview).toContain("description: v1");
  await call("bob", "restore_skill_file", {
    name: "hist",
    version_id: h[0].version_id,
  });
  expect((await call("bob", "get_skill"))[0].description).toBe("v1");
  expect(await call("bob", "skill_history", { name: "hist" })).toHaveLength(2); // restore is undoable
});

it("only admins may change the default skills", async () => {
  const edit = (user: string) =>
    call(user, "update_skill_file", {
      name: "skola",
      path: "references/tools.md",
      content: "# Tools (edited by admin)",
      scope: "default",
    });
  expect(await edit("alice")).toEqual({
    error: "Only an admin can change the default skills",
  });
  expect(await edit("boss")).toEqual({ saved: "skola/references/tools.md" });
  // Everyone without their own copy sees it at once.
  expect(
    await call("bob", "get_skill", {
      name: "skola",
      path: "references/tools.md",
    })
  ).toBe("# Tools (edited by admin)");
  expect(
    await call("boss", "update_skill_file", {
      name: "skola",
      content: "x",
      scope: "everyone",
    })
  ).toHaveProperty("error");
});

it("serves skills as MCP instructions, resources and prompts", async () => {
  const init = await rpc("alice", "initialize", {
    protocolVersion: "2025-06-18",
  });
  expect(init.result.capabilities).toHaveProperty("resources");
  expect(init.result.capabilities).toHaveProperty("prompts");
  expect(init.result.instructions).toContain('get_skill with name "skola"');

  const res = await rpc("alice", "resources/list");
  const uris = res.result.resources.map((r: any) => r.uri);
  expect(uris).toEqual(
    expect.arrayContaining(["skill://index.json", "skill://skola/SKILL.md"])
  );
  const read = await rpc("alice", "resources/read", {
    uri: "skill://skola/SKILL.md",
  });
  expect(read.result.contents[0].text).toContain("name: skola");
  const idx = await rpc("alice", "resources/read", {
    uri: "skill://index.json",
  });
  expect(JSON.parse(idx.result.contents[0].text).skills[0].name).toBe("skola");
  expect(
    (await rpc("alice", "resources/read", { uri: "skill://nope/SKILL.md" }))
      .error.code
  ).toBe(-32002);

  expect((await rpc("alice", "prompts/list")).result.prompts[0].name).toBe(
    "skola"
  );
  const prompt = await rpc("alice", "prompts/get", { name: "skola" });
  expect(prompt.result.messages[0].content.text).toContain("name: skola");
  expect((await rpc("alice", "prompts/get", { name: "nope" })).error.code).toBe(
    -32602
  );
});

it("marks delete tools destructive and reads as read-only", async () => {
  const t = (await rpc("alice", "tools/list")).result.tools;
  const ann = Object.fromEntries(t.map((x: any) => [x.name, x.annotations]));
  expect(ann.delete_skill).toEqual({
    readOnlyHint: false,
    destructiveHint: true,
  });
  expect(ann.update_skill_file).toEqual({
    readOnlyHint: false,
    destructiveHint: false,
  });
  expect(ann.get_skill).toEqual({ readOnlyHint: true });
  expect(ann.skill_history).toEqual({ readOnlyHint: true });
});

it("serves /llms.txt about the product and /llms-skill.txt about the skills, linked both ways", async () => {
  const o = "https://skola.example";
  const product = productText(o, ["skola"]);
  const skills = await skillText(db, o);
  for (const t of [product, skills]) {
    const lines = t.split("\n");
    expect(lines[0]).toMatch(/^# \S/); // H1 first
    expect(lines[2]).toMatch(/^> /); // then the summary blockquote
    expect(t).toMatch(/\n## /);
    for (const [, href] of t.matchAll(/\]\((https?:[^)]+)\)/g))
      expect(href.startsWith(`${o}/`)).toBe(true);
  }
  expect(product).toContain(`${o}/llms-skill.txt`);
  expect(skills).toContain(`${o}/llms.txt`);
  expect(product).not.toContain("name: skola"); // no skill bodies in the product file
  expect(skills).toContain("### File: skola/SKILL.md");
  expect(skills).toContain("name: skola");

  // A user's own skill never shows up in the public files.
  await call("alice", "create_skill", {
    name: "private-one",
    description: "d",
    body: "SECRET-BODY",
  });
  const again = await skillText(db, o);
  expect(again).not.toContain("SECRET-BODY");
  expect(again).not.toContain("private-one");
});

it("does not bring the built-in skill back after the defaults were deleted", async () => {
  await deleteSkill(db, DEFAULT_OWNER, "skola", "boss");
  resetSeedFlag();
  expect(await ownerFiles(db, DEFAULT_OWNER)).toHaveLength(0);
  // Only alice's own private skill is left; no default came back.
  expect(
    (await effectiveFiles(db, "alice")).every((f) => f.skill === "private-one")
  ).toBe(true);
});

it("etags change with content, and the zip is structurally valid", () => {
  expect(etagOf("a")).not.toBe(etagOf("b"));
  expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926); // standard check value
  const z = zip([
    { path: "skola/SKILL.md", content: "hello" },
    { path: "skola/references/a.md", content: "ünï" },
  ]);
  expect(z.readUInt32LE(0)).toBe(0x04034b50);
  expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
  expect(z.readUInt16LE(z.length - 22 + 10)).toBe(2);
});
