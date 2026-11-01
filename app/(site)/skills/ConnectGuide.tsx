import { connectGuide, mcpUrl } from "@/server/connectGuide";
import CopyButton from "./CopyButton";

const box = {
  overflow: "auto",
  padding: 12,
  border: "1px solid rgba(128,128,128,.4)",
  borderRadius: 8,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  fontSize: 13,
  margin: 0,
} as const;

/** Something to paste, with its copy button right next to it. */
function CodeBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        margin: "6px 0 14px",
      }}
    >
      <pre style={{ ...box, flex: 1, minWidth: 0 }}>{text}</pre>
      <CopyButton text={text} />
    </div>
  );
}

/**
 * The connect-and-install guide. It renders the same blocks /llms.txt is made from, so the page
 * for people and the page for AI agents never disagree.
 */
export default function ConnectGuide({
  origin,
  skills,
  agentText,
}: {
  origin: string;
  skills: string[];
  /** The complete /llms.txt text, for the copy-for-an-AI button. */
  agentText: string;
}) {
  const sections = connectGuide(origin, skills);
  return (
    <>
      <section
        style={{
          border: "1px solid rgba(128,128,128,.4)",
          borderRadius: 12,
          padding: 16,
          margin: "16px 0 8px",
        }}
      >
        <strong>Skola MCP server address</strong>
        <CodeBlock text={mcpUrl(origin)} />
        <p style={{ margin: 0 }}>
          <CopyButton
            label="Copy this whole page for an AI agent"
            text={agentText}
          />{" "}
          <a href="/llms.txt">/llms.txt</a>
        </p>
      </section>

      {sections.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.title}</h2>
          {s.blocks.map((b, i) =>
            b.kind === "heading" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
              <h3 key={i}>{b.text}</h3>
            ) : b.kind === "text" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
              <p key={i}>{b.text}</p>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
              <CodeBlock key={i} text={b.text} />
            )
          )}
        </section>
      ))}
    </>
  );
}
