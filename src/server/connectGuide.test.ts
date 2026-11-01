import { expect, it } from "vitest";
import { connectGuide, guideMarkdown, mcpUrl } from "./connectGuide";
import { productText } from "./skillText";

const O = "https://skola.example";
const codeOf = (skills = ["skola"]) =>
  connectGuide(O, skills).flatMap((s) =>
    s.blocks.flatMap((b) => (b.kind === "code" ? [b] : []))
  );

it("has one MCP address, and every snippet that needs it uses exactly that one", () => {
  const url = mcpUrl(O);
  expect(url).toBe("https://skola.example/mcp");
  const needsUrl = codeOf().filter(
    (b) => /mcp\b/.test(b.text) && !b.text.includes("llms")
  );
  expect(needsUrl.length).toBeGreaterThanOrEqual(5); // the address box and each client
  for (const b of needsUrl) {
    const urls = b.text.match(/https:\/\/[^\s"']+/g) ?? [];
    expect(urls.length, b.text).toBeGreaterThan(0);
    expect(
      urls.every((u) => u === url),
      b.text
    ).toBe(true); // no stray or old address
  }
});

it("covers each assistant with a copyable command or config", () => {
  const all = codeOf()
    .map((b) => b.text)
    .join("\n");
  expect(all).toContain(
    "claude mcp add --transport http skola https://skola.example/mcp"
  );
  expect(all).toContain('"mcp-remote"'); // Claude Desktop config
  expect(all).toContain("[mcp_servers.skola]"); // Codex
  const titles = connectGuide(O, ["skola"])
    .flatMap((s) =>
      s.blocks
        .filter((b) => b.kind === "heading")
        .map((b) => (b as { text: string }).text)
    )
    .join("|");
  for (const name of [
    "Claude Code",
    "Claude on the web",
    "ChatGPT",
    "Cursor",
    "Codex",
    "Any other assistant",
  ])
    expect(titles).toContain(name);
});

it("config snippets are valid JSON, and the install commands point at the real zip", () => {
  const json = codeOf().filter((b) => b.lang === "json");
  expect(json.length).toBe(2);
  for (const b of json) expect(() => JSON.parse(b.text)).not.toThrow();
  expect(JSON.parse(json[1].text)).toEqual({
    mcpServers: { skola: { url: "https://skola.example/mcp" } },
  });

  const zip = "https://skola.example/skills/skola/bundle.zip";
  const bash = codeOf().find(
    (b) => b.lang === "bash" && b.text.includes("unzip")
  );
  expect(bash?.text).toContain(zip);
  expect(bash?.text).toContain("~/.claude/skills");
  const ps = codeOf().find((b) => b.lang === "powershell");
  expect(ps?.text).toContain(zip);
  expect(ps?.text).toContain("$HOME\\.claude\\skills");
});

it("gives every skill its own download, and a prompt that names the first one", () => {
  const code = codeOf(["skola", "my-style"]).map((b) => b.text);
  expect(code).toContain("https://skola.example/skills/skola/bundle.zip");
  expect(code).toContain("https://skola.example/skills/my-style/bundle.zip");
  expect(code.some((c) => c.includes('get_skill with name "skola"'))).toBe(
    true
  );
  expect(
    codeOf([])
      .map((b) => b.text)
      .some((c) => c.includes("/skills/skola/"))
  ).toBe(true); // sensible default
});

it("/llms.txt carries the very same guide: every snippet, fenced, and the same headings", () => {
  const skills = ["skola"];
  const llms = productText(O, skills);
  for (const s of connectGuide(O, skills)) {
    expect(llms).toContain(`## ${s.title}`);
    for (const b of s.blocks) {
      if (b.kind === "code")
        expect(llms).toContain(`\`\`\`${b.lang ?? ""}\n${b.text}\n\`\`\``);
      else expect(llms).toContain(b.text);
    }
  }
  expect(llms.startsWith("# Skola\n")).toBe(true);
  expect(llms).toContain(guideMarkdown(O, skills).trimEnd());
  // it names the human page too, so agents can point people at it
  expect(llms).toContain(`${O}/skills`);
});

it("never uses a relative or foreign address in the guide", () => {
  const md = guideMarkdown(O, ["skola"]);
  for (const [, href] of md.matchAll(/\]\((https?:[^)]+)\)/g))
    expect(href.startsWith(O)).toBe(true);
  expect(md).not.toMatch(/localhost|example\.org/);
});
