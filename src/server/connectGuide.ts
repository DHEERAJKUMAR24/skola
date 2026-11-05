import { audiences } from "./oauth";

/**
 * The one place that says how to connect an assistant to Skola and how to install its skills.
 * The human page (/skills) renders these blocks with copy buttons; /llms.txt renders the very
 * same blocks as markdown for AI agents. Change the guide here and both follow.
 */
export type Block =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  /** Something to paste: gets a copy button on the page and a fenced block in llms.txt. */
  | { kind: "code"; text: string; lang?: string };

export interface GuideSection {
  id: string;
  title: string;
  blocks: Block[];
}

export const mcpUrl = (o: string) => audiences(o).mcp;

const text = (t: string): Block => ({ kind: "text", text: t });
const heading = (t: string): Block => ({ kind: "heading", text: t });
const code = (t: string, lang?: string): Block => ({
  kind: "code",
  text: t,
  lang,
});

export function connectGuide(o: string, skills: string[]): GuideSection[] {
  const url = mcpUrl(o);
  const first = skills[0] ?? "skola";
  const zip = (name: string) => `${o}/skills/${name}/bundle.zip`;

  return [
    {
      id: "connect",
      title: "1. Connect your AI assistant",
      blocks: [
        text(
          "Skola has one MCP server, and this one address works in every assistant:"
        ),
        code(url),
        text(
          "The assistant opens a Skola sign-in page and asks you to allow access. Sign in with your Skola account. It can then read your decks, add and edit cards, and quiz you."
        ),

        heading("Claude Code"),
        text(
          "Run this in a terminal. Then type /mcp inside Claude Code, choose skola, and sign in."
        ),
        code(`claude mcp add --transport http skola ${url}`, "bash"),

        heading("Claude on the web and in the desktop app"),
        text(
          "Open Settings, then Connectors, then Add custom connector. Name it Skola, paste the address above, and choose Connect to sign in. Custom connectors may need a paid Claude plan."
        ),

        heading("Claude Desktop with a config file (advanced)"),
        text(
          "Add this to claude_desktop_config.json. It needs Node.js, and it signs in through your browser."
        ),
        code(
          JSON.stringify(
            {
              mcpServers: {
                skola: { command: "npx", args: ["mcp-remote", url] },
              },
            },
            null,
            2
          ),
          "json"
        ),

        heading("ChatGPT"),
        text(
          "Open Settings, then Connectors, then Advanced settings and turn on Developer mode. Add a custom connector with the address above. Which plans can do this changes over time."
        ),

        heading("Cursor"),
        text(
          "Put this in .cursor/mcp.json (or your global Cursor MCP settings):"
        ),
        code(
          JSON.stringify({ mcpServers: { skola: { url } } }, null, 2),
          "json"
        ),

        heading("Codex"),
        text("Add this to ~/.codex/config.toml and sign in when it asks:"),
        code(`[mcp_servers.skola]\nurl = "${url}"`, "toml"),

        heading("Any other assistant"),
        text(
          "Use any client that supports MCP over streamable HTTP with OAuth sign-in, and give it the address above."
        ),
      ],
    },
    {
      id: "skills",
      title: "2. Install the Skola skill",
      blocks: [
        text(
          "The skill teaches the assistant how to write good cards, quiz you honestly and keep decks tidy. You usually do not need to install anything: once connected, the assistant reads the skill from Skola itself (the get_skill tool, the skill:// resources and a prompt for each skill)."
        ),
        heading("Tell the assistant to use it"),
        text(
          "Paste this into the chat if the assistant does not pick the skill up on its own:"
        ),
        code(
          `Use the Skola MCP tools. First call get_skill with name "${first}" and follow it.`
        ),

        heading("Download it"),
        text(
          "To keep the skill on your computer, or for tools that load skills from a folder, download the folder as a zip. It contains the skill's SKILL.md and its reference files."
        ),
        ...skills.flatMap((name) => [
          text(`Skill "${name}":`),
          code(zip(name)),
        ]),
        text("Just the main instructions as plain text:"),
        code(`${o}/skills/${first}/SKILL.md`),
        text("Every skill and its files in one text file:"),
        code(`${o}/llms-skill.txt`),

        heading("Claude Code, for all your projects (macOS and Linux)"),
        code(
          `mkdir -p ~/.claude/skills && curl -fsSL ${zip(first)} -o /tmp/${first}.zip && unzip -o /tmp/${first}.zip -d ~/.claude/skills`,
          "bash"
        ),
        heading("Claude Code, for all your projects (Windows PowerShell)"),
        code(
          `Invoke-WebRequest ${zip(first)} -OutFile $env:TEMP\\${first}.zip; Expand-Archive $env:TEMP\\${first}.zip -DestinationPath $HOME\\.claude\\skills -Force`,
          "powershell"
        ),

        heading("Claude on the web and in the desktop app"),
        text(
          "Download the zip above. In Claude's settings open Skills (under Capabilities) and upload it."
        ),

        heading("Other tools"),
        text(
          `Unzip the folder into the tool's skills directory. The folder must be named like the skill (${first}) and contain SKILL.md. Assistants that cannot load skills still get the same text through the connection.`
        ),
      ],
    },
    {
      id: "own",
      title: "3. Make your own skills",
      blocks: [
        text(
          "You can write your own skills, or customise a copy of a default one. Yours are private, and a skill of yours with the same name replaces the default for you only. Ask your connected assistant to create or edit one (the tools create_skill, update_skill_file, delete_skill and restore_skill_file), or use the editor:"
        ),
        code(`${o}/skills/edit`),
      ],
    },
    {
      id: "agents",
      title: "For AI agents",
      blocks: [
        text(
          "This page as plain text, for an assistant that is reading it on your behalf:"
        ),
        code(`${o}/llms.txt`),
        text("The skills as plain text:"),
        code(`${o}/llms-skill.txt`),
        text("The guide and every default skill in one file:"),
        code(`${o}/skills/llm.txt`),
      ],
    },
  ];
}

/** The guide as markdown, for /llms.txt. Every code block is fenced so it can be pasted as is. */
export function guideMarkdown(o: string, skills: string[]): string {
  return connectGuide(o, skills)
    .map((s) =>
      [
        `## ${s.title}`,
        "",
        ...s.blocks.flatMap((b) =>
          b.kind === "heading"
            ? [`### ${b.text}`, ""]
            : b.kind === "text"
              ? [b.text, ""]
              : [`\`\`\`${b.lang ?? ""}`, b.text, "```", ""]
        ),
      ].join("\n")
    )
    .join("\n");
}
