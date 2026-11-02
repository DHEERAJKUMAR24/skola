import { getDb } from "@/server/db";
import { productText } from "@/server/skillText";
import { listSkills } from "@/server/skills";
import type { Metadata } from "next";
import Link from "next/link";
import { siteOrigin } from "../origin";
import ConnectGuide from "./ConnectGuide";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connect Skola++ to your AI assistant",
  description:
    "The Skola MCP server address, how to connect Claude, ChatGPT and other assistants, and how to install the Skola skill.",
};

/** The one page that explains how to connect an assistant and install the skills. */
export default async function SkillsPage() {
  const [skills, origin] = await Promise.all([
    listSkills(getDb(), null),
    siteOrigin(),
  ]);
  const names = skills.map((s) => s.name);
  return (
    <>
      <h1>Connect Skola++ to your AI assistant</h1>
      <p>
        Skola can work with Claude, ChatGPT and other AI assistants. They read
        your decks, add and edit cards, and quiz you, using an agent skill that
        teaches them to write good flashcards and to quiz you honestly. This
        page has the server address, the steps for each assistant, and the skill
        downloads. Everything you need to paste has a Copy button.
      </p>

      <ConnectGuide
        origin={origin}
        skills={names}
        agentText={productText(origin, names)}
      />

      <section id="default-skills">
        <h2>The default skills</h2>
        <ul>
          {skills.map((s) => (
            <li key={s.name}>
              <Link href={`/skills/${s.name}`}>
                <strong>{s.name}</strong>
              </Link>
              : {s.description}
            </li>
          ))}
        </ul>
        <p>
          Open a skill to read its files and copy any of them. Your own skills
          are managed in the <Link href="/skills/edit">editor</Link>.
        </p>
      </section>
    </>
  );
}
