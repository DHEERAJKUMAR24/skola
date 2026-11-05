import { Alert } from "@/components/ui/Alert";
import { Paper } from "@/components/ui/Paper";
import { Spinner } from "@/components/ui/Spinner";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { Link } from "react-router-dom";
import CopyButton from "./CopyButton";
import "./Skills.css";
import { type Overview, useSkillsApi } from "./useOverview";

/** Something to paste, with its copy button right next to it. */
export function CodeBlock({ text, what }: { text: string; what?: string }) {
  return (
    <div className="skills-code">
      <pre className="skills-code__text">{text}</pre>
      <CopyButton text={text} what={what} />
    </div>
  );
}

/**
 * Connect an assistant and install the skills, inside the app. The same guide is also a public
 * server-rendered page at /skills (and /skills/llm.txt as text) for AI agents.
 */
export default function ConnectView() {
  const { data, error } = useSkillsApi<Overview>();

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data) return <Spinner />;

  return (
    <Stack gap="lg" className="skills-page">
      <Text>
        Skola can work with Claude, ChatGPT and other AI assistants. They read
        your decks, add and edit cards, and quiz you, using agent skills that
        teach them to write good flashcards and to quiz you honestly. Everything
        you need to paste has a Copy button.
      </Text>

      <Paper withBorder className="skills-card">
        <Text weight="semibold">Skola MCP server address</Text>
        <CodeBlock text={data.mcp} what="MCP server address" />
        <div className="skills-row">
          <CopyButton
            label="Copy this whole guide for an AI agent"
            text={data.agentText}
            what="Instructions for an AI agent"
          />
          <a href="/skills/llm.txt" target="_blank" rel="noreferrer">
            /skills/llm.txt
          </a>
          <a href="/skills" target="_blank" rel="noreferrer">
            public page for AI agents
          </a>
        </div>
      </Paper>

      {data.sections.map((s) => (
        <section key={s.id} id={s.id} className="skills-section">
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

      <section id="default-skills" className="skills-section">
        <h2>The default skills</h2>
        <ul>
          {data.skills.map((s) => (
            <li key={s.name}>
              <Link to={`/settings/connect/${s.name}`}>
                <strong>{s.name}</strong>
              </Link>
              : {s.description}
            </li>
          ))}
        </ul>
        <p>
          Open a skill to read its files and copy any of them. Your own skills
          are managed in the <Link to="/settings/skills">skills editor</Link>.
        </p>
      </section>
    </Stack>
  );
}
