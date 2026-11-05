import { guideMarkdown, mcpUrl } from "./connectGuide";
import type { Db } from "./db";
import { effectiveFiles, listSkills } from "./skills";

const FENCE = "````";

/**
 * /llms.txt: what Skola is and how to connect to it, in the llmstxt.org layout (H1, blockquote
 * summary, H2 sections). The connect and install sections are the same guide the /skills page
 * shows people (see connectGuide.ts). It points to /llms-skill.txt for the agent skills.
 */
export function productText(o: string, skills: string[]) {
  return [
    "# Skola",
    "",
    "> Skola is a free, open-source, local-first spaced-repetition flashcard app. It schedules reviews with FSRS so each card comes back just before you would forget it, works offline, and syncs across devices. AI assistants can connect over MCP to read decks, add and edit cards, quiz the user and tidy decks.",
    "",
    "Skola is for anyone who learns facts for the long term: students preparing for exams, people learning a language, professionals keeping up with a field. Cards are organised in nested decks and tagged, and come in six types: basic, reverse, cloze, multiple choice, list recall and image occlusion. Study is guided by presets (daily limits, learning steps, desired retention, easy days, leech and sibling rules) and optional exam dates that pull reviews in before the test.",
    "",
    `The MCP server address is ${mcpUrl(o)} . To use Skola from an assistant, connect it there, sign in, and read the agent skill before using the card tools. The steps for each assistant and for installing the skill are below. A page with the same content for people, with copy buttons, is at ${o}/skills .`,
    "",
    "## Use Skola",
    "",
    `- [Open the app](${o}/): the study app in the browser, installable as a PWA`,
    `- [Create an account](${o}/signup): free sign-up`,
    `- [Sign in](${o}/login)`,
    "",
    guideMarkdown(o, skills).trimEnd(),
    "",
    "## Links",
    "",
    `- [MCP endpoint](${mcpUrl(o)}): Streamable HTTP, JSON-RPC over POST, Bearer token with audience ${mcpUrl(o)} and scope mcp`,
    `- [Protected resource metadata](${o}/.well-known/oauth-protected-resource/mcp): RFC 9728 discovery for the OAuth flow`,
    `- [Authorization server metadata](${o}/.well-known/oauth-authorization-server): OAuth 2.1 with PKCE (S256), dynamic client registration, opaque tokens bound to one audience`,
    `- [Connect and install guide for people](${o}/skills): this content with copy buttons`,
    `- [Everything in one file](${o}/skills/llm.txt): this guide and the full text of every default skill`,
    `- [Agent skills (llms-skill.txt)](${o}/llms-skill.txt): the skill index and the full text of every default skill`,
    "",
    "## Optional",
    "",
    "- Skola is licensed AGPL-3.0; a publicly run modified version must publish its source.",
    "",
  ].join("\n");
}

/**
 * /skills/llm.txt: everything an AI agent needs in one fetch. The product overview with the
 * connect and install guide first, then the full text of every default skill.
 */
export async function allText(db: Db, o: string) {
  const skills = (await listSkills(db, null)).map((s) => s.name);
  return [
    productText(o, skills).trimEnd(),
    "",
    "---",
    "",
    (await skillText(db, o)).trimEnd(),
    "",
  ].join("\n");
}

/**
 * /llms-skill.txt: the shared default skills. A link map first, then the full text of every
 * file so one fetch is enough. A user's own skills are private and travel over MCP instead.
 */
export async function skillText(db: Db, o: string) {
  const skills = await listSkills(db, null);
  const files = await effectiveFiles(db, null);
  const raw = (skill: string, path: string) => `${o}/skills/${skill}/${path}`;

  const out = [
    "# Skola agent skills",
    "",
    "> Agent skills teach an AI assistant how to use Skola: writing good flashcards, quizzing the user honestly, and keeping decks tidy. This file lists the default skills and then contains their full text. Product overview: [llms.txt](" +
      `${o}/llms.txt` +
      ").",
    "",
    `The skills need the Skola MCP server (${mcpUrl(o)}) to be connected. Once connected, the same skills are available inside the MCP session through the get_skill tool, as skill:// resources and as prompts, and the user can create, edit and delete their own skills there. A user's own skill with the same name replaces the default for that user.`,
    "",
    "## Skills",
    "",
    ...skills.map(
      (s) => `- [${s.name}](${raw(s.name, "SKILL.md")}): ${s.description}`
    ),
    "",
    "## Reference files",
    "",
    ...files
      .filter((f) => f.path !== "SKILL.md")
      .map((f) => `- [${f.skill}/${f.path}](${raw(f.skill, f.path)})`),
    "",
    "## Downloads and docs",
    "",
    ...skills.map(
      (s) =>
        `- [${s.name}.zip](${o}/skills/${s.name}/bundle.zip): the whole skill folder, ready to unzip into a skills directory`
    ),
    `- [Skills for humans](${o}/skills): install steps for each assistant`,
    `- [Skola overview (llms.txt)](${o}/llms.txt)`,
    "",
    "## Full text",
    "",
  ];
  for (const f of files)
    out.push(
      `### File: ${f.skill}/${f.path}`,
      "",
      `${FENCE}markdown`,
      f.content.trimEnd(),
      FENCE,
      ""
    );
  return out.join("\n");
}
