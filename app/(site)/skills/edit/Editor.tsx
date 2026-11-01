"use client";

import { useCallback, useEffect, useState } from "react";

interface Listing {
  admin: boolean;
  scope: "mine" | "default";
  skills: { name: string; files: { path: string; updatedAt: number }[] }[];
}
interface Version {
  id: number;
  content: string;
  savedAt: number;
}

async function api(body: object) {
  const res = await fetch("/api/skills/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

const TEMPLATE = (name: string) =>
  `---\nname: ${name}\ndescription: Say when the assistant should use this skill and what it does.\n---\n\n# ${name}\n\nInstructions go here.\n`;

export default function Editor() {
  const [scope, setScope] = useState<"mine" | "default">("mine");
  const [list, setList] = useState<Listing | null>(null);
  const [sel, setSel] = useState<{ skill: string; path: string } | null>(null);
  const [text, setText] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);

  const say = (text: string, error = false) => setMsg({ text, error });
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) say(ok);
    } catch (e) {
      say((e as Error).message, true);
    }
  }, []);

  const refresh = useCallback(
    () => run(async () => setList(await api({ op: "list", scope }))),
    [run, scope]
  );
  useEffect(() => {
    setSel(null);
    setText("");
    setVersions(null);
    void refresh();
  }, [refresh]);

  const open = (skill: string, path: string) =>
    run(async () => {
      const d = await api({ op: "get", scope, skill, path });
      setSel({ skill, path });
      setText(d.content);
      setVersions(null);
    });

  const save = (skill: string, path: string, content: string) =>
    run(async () => {
      await api({ op: "save", scope, skill, path, content });
      await refresh();
      setSel({ skill, path });
      setText(content);
    }, "Saved. Assistants see it on their next read.");

  return (
    <div>
      {list?.admin && (
        <p>
          <button
            type="button"
            disabled={scope === "mine"}
            onClick={() => setScope("mine")}
          >
            My skills
          </button>{" "}
          <button
            type="button"
            disabled={scope === "default"}
            onClick={() => setScope("default")}
          >
            Default skills (admin)
          </button>
        </p>
      )}
      <p>
        {scope === "default"
          ? "These are the shared defaults everyone gets unless they have their own skill of the same name."
          : "These are your own skills. A skill of yours replaces a default of the same name for you only. Delete it to go back to the default."}
      </p>
      {msg && (
        <output
          style={{ display: "block", color: msg.error ? "crimson" : "inherit" }}
        >
          {msg.text}
        </output>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220 }}>
          {list?.skills.length === 0 && <p>No skills yet.</p>}
          {list?.skills.map((s) => (
            <div key={s.name} style={{ marginBottom: 12 }}>
              <strong>{s.name}</strong>
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {s.files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => open(s.name, f.path)}
                      style={{
                        fontWeight:
                          sel?.skill === s.name && sel.path === f.path
                            ? 700
                            : 400,
                      }}
                    >
                      {f.path}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete the whole skill "${s.name}"?`))
                    void run(async () => {
                      await api({ op: "deleteSkill", scope, skill: s.name });
                      setSel(null);
                      setText("");
                      await refresh();
                    }, "Deleted. You can restore files from history.");
                }}
              >
                Delete skill
              </button>
            </div>
          ))}
          <h3>New skill</h3>
          <input
            placeholder="skill-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value.toLowerCase())}
          />{" "}
          <button
            type="button"
            disabled={!newName}
            onClick={() => {
              void save(newName, "SKILL.md", TEMPLATE(newName)).then(() =>
                setNewName("")
              );
            }}
          >
            Create
          </button>
          {sel && (
            <>
              <h3>New file in {sel.skill}</h3>
              <input
                placeholder="references/notes.md"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />{" "}
              <button
                type="button"
                disabled={!newPath}
                onClick={() => {
                  void save(sel.skill, newPath, "# Notes\n").then(() =>
                    setNewPath("")
                  );
                }}
              >
                Add
              </button>
            </>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 300 }}>
          {sel ? (
            <>
              <p>
                <code>
                  {sel.skill}/{sel.path}
                </code>
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 420,
                  fontFamily: "monospace",
                  fontSize: 13,
                }}
              />
              <p>
                <button
                  type="button"
                  onClick={() => save(sel.skill, sel.path, text)}
                >
                  Save
                </button>{" "}
                <button
                  type="button"
                  onClick={() =>
                    run(async () =>
                      setVersions(
                        (
                          await api({
                            op: "history",
                            scope,
                            skill: sel.skill,
                            path: sel.path,
                          })
                        ).versions
                      )
                    )
                  }
                >
                  History
                </button>{" "}
                {sel.path !== "SKILL.md" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete ${sel.path}?`))
                        void run(async () => {
                          await api({
                            op: "deleteFile",
                            scope,
                            skill: sel.skill,
                            path: sel.path,
                          });
                          setSel(null);
                          setText("");
                          await refresh();
                        }, "Deleted.");
                    }}
                  >
                    Delete file
                  </button>
                )}
              </p>
              {versions && (
                <>
                  <h3>Earlier versions</h3>
                  {versions.length === 0 && <p>No earlier versions.</p>}
                  <ul>
                    {versions.map((v) => (
                      <li key={v.id}>
                        {new Date(v.savedAt).toLocaleString()}{" "}
                        <button
                          type="button"
                          onClick={() => setText(v.content)}
                        >
                          Load into editor
                        </button>{" "}
                        <button
                          type="button"
                          onClick={() =>
                            run(async () => {
                              await api({
                                op: "restore",
                                scope,
                                skill: sel.skill,
                                path: sel.path,
                                versionId: v.id,
                              });
                              await open(sel.skill, sel.path);
                            }, "Restored.")
                          }
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p>Pick a file to edit.</p>
          )}
        </div>
      </div>
    </div>
  );
}
