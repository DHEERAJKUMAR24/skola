import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Stack } from "@/components/ui/Stack";
import { Link, useParams } from "react-router-dom";
import { CodeBlock } from "./ConnectView";
import CopyButton from "./CopyButton";
import "./Skills.css";
import { type SkillDetail, useSkillsApi } from "./useOverview";

/** One default skill: its files, with copy buttons and download links. */
export default function SkillView() {
  const { item } = useParams();
  const { data, error } = useSkillsApi<SkillDetail>(
    `?name=${encodeURIComponent(item ?? "")}`
  );

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data) return <Spinner />;
  const { name, origin } = data;

  return (
    <Stack gap="md" className="skills-page">
      <p>
        <Link to="/settings/connect">All skills</Link>
      </p>
      <h2>{name}</h2>
      <p>
        <a href={`/skills/${name}/bundle.zip`}>
          Download the skill folder (.zip)
        </a>
        {" · "}
        <a href={`/skills/${name}/SKILL.md`} target="_blank" rel="noreferrer">
          Raw SKILL.md
        </a>
        {" · "}
        <a href={`/skills/${name}`} target="_blank" rel="noreferrer">
          Public page
        </a>
      </p>
      <div className="skills-row">
        <CopyButton
          label="Copy zip link"
          text={`${origin}/skills/${name}/bundle.zip`}
          what="Zip link"
        />
        <CopyButton
          label="Copy SKILL.md link"
          text={`${origin}/skills/${name}/SKILL.md`}
          what="SKILL.md link"
        />
        <CopyButton
          label="Copy MCP server address"
          text={data.mcp}
          what="MCP server address"
        />
      </div>
      <h3>Tell the assistant to use it</h3>
      <CodeBlock
        text={`Use the Skola MCP tools. First call get_skill with name "${name}" and follow it.`}
      />
      <h3>Files</h3>
      {data.files.map((f) => (
        <details key={f.path} open={f.path === "SKILL.md"}>
          <summary>
            <code>{f.path}</code>
          </summary>
          <div className="skills-row">
            <CopyButton text={f.content} what={f.path} />
            <a
              href={`/skills/${name}/${f.path}`}
              target="_blank"
              rel="noreferrer"
            >
              raw
            </a>
          </div>
          <pre className="skills-file">{f.content}</pre>
        </details>
      ))}
    </Stack>
  );
}
