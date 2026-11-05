import { useEffect, useState } from "react";

export interface GuideBlock {
  kind: "heading" | "text" | "code";
  text: string;
  lang?: string;
}
export interface Overview {
  origin: string;
  mcp: string;
  agentText: string;
  sections: { id: string; title: string; blocks: GuideBlock[] }[];
  skills: { name: string; description: string; files: string[] }[];
}
export interface SkillDetail {
  origin: string;
  mcp: string;
  name: string;
  files: { path: string; content: string }[];
}

/** Loads the public skills overview (or one skill with its files) from the server. */
export function useSkillsApi<T>(query = "") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/skills/overview${query}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok)
          throw new Error(body.error ?? `Request failed (${r.status})`);
        if (live) setData(body as T);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [query]);
  return { data, error };
}
