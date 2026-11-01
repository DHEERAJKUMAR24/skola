import { mcpUrl } from "@/server/connectGuide";
import { getDb } from "@/server/db";
import { effectiveFiles } from "@/server/skills";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { siteOrigin } from "../../origin";
import CopyButton from "../CopyButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: { params: Promise<{ name: string }> }): Promise<Metadata> {
  return { title: `${(await params).name} skill for Skola` };
}

export default async function SkillPage({
  params,
}: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const files = (await effectiveFiles(getDb(), null)).filter(
    (f) => f.skill === name
  );
  if (!files.length) notFound();
  const origin = await siteOrigin();

  return (
    <>
      <p>
        <Link href="/skills">All skills</Link>
      </p>
      <h1>{name}</h1>
      <p>
        <a href={`/skills/${name}/bundle.zip`}>
          Download the skill folder (.zip)
        </a>
        {" · "}
        <a href={`/skills/${name}/SKILL.md`}>Raw SKILL.md</a>
        {" · "}
        <a href="/llms-skill.txt">llms-skill.txt</a>
        {" · "}
        <Link href="/skills#skills">How to install it</Link>
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <CopyButton
          label="Copy zip link"
          text={`${origin}/skills/${name}/bundle.zip`}
        />
        <CopyButton
          label="Copy SKILL.md link"
          text={`${origin}/skills/${name}/SKILL.md`}
        />
        <CopyButton label="Copy MCP server address" text={mcpUrl(origin)} />
      </div>

      <h2>Files</h2>
      {files.map((f) => (
        <details key={f.path} open={f.path === "SKILL.md"}>
          <summary>
            <code>{f.path}</code>
          </summary>
          <p>
            <CopyButton text={f.content} />{" "}
            <a href={`/skills/${name}/${f.path}`}>raw</a>
          </p>
          <pre
            style={{
              overflow: "auto",
              padding: 12,
              border: "1px solid rgba(128,128,128,.4)",
              borderRadius: 8,
              whiteSpace: "pre-wrap",
              fontSize: 13,
            }}
          >
            {f.content}
          </pre>
        </details>
      ))}
    </>
  );
}
