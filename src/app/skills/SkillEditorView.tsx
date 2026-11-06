import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { TextInput } from "@/components/ui/TextInput";
import { Textarea } from "@/components/ui/Textarea";
import { NotSignedIn, authFetch, startLogin, useAuthEmail } from "@/logic/auth";
import { useCallback, useEffect, useState } from "react";
import "./Skills.css";

interface Listing {
  admin: boolean;
  scope: "mine" | "default";
  skills: {
    name: string;
    source: "default" | "custom";
    overridesDefault: boolean;
    files: { path: string; updatedAt: number }[];
  }[];
}
interface Version {
  id: number;
  content: string;
  savedAt: number;
}

async function api(body: object) {
  const res = await authFetch("/api/skills/admin", {
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

/** Your own skills (and, for admins, the shared defaults): create, edit, history, restore. */
export default function SkillEditorView() {
  const email = useAuthEmail();
  const [scope, setScope] = useState<"mine" | "default">("mine");
  const [list, setList] = useState<Listing | null>(null);
  const [sel, setSel] = useState<{
    skill: string;
    path: string;
    source: "default" | "custom";
  } | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);

  const say = (t: string, error = false) => setMsg({ text: t, error });
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) say(ok);
    } catch (e) {
      say(
        e instanceof NotSignedIn
          ? "Your sign-in expired. Sign in again."
          : (e as Error).message,
        true
      );
    }
  }, []);

  const refresh = useCallback(
    () => run(async () => setList(await api({ op: "list", scope }))),
    [run, scope]
  );
  useEffect(() => {
    if (!email) return;
    setSel(null);
    setText("");
    setSaved("");
    setVersions(null);
    void refresh();
  }, [refresh, email]);

  if (!email)
    return (
      <Stack gap="md" align="start">
        <Text>
          Sign in to write your own skills. They are stored in your account, and
          your assistants read them over the connection.
        </Text>
        <Button variant="primary" onClick={() => startLogin("login")}>
          Sign in
        </Button>
      </Stack>
    );

  const open = (skill: string, path: string, source: "default" | "custom") =>
    run(async () => {
      const d = await api({ op: "get", scope, skill, path });
      setSel({ skill, path, source });
      setText(d.content);
      setSaved(d.content);
      setVersions(null);
    });

  const save = (skill: string, path: string, content: string) =>
    run(async () => {
      await api({ op: "save", scope, skill, path, content });
      await refresh();
      setSel({ skill, path, source: "custom" });
      setText(content);
      setSaved(content);
    }, "Saved. Assistants see it on their next read.");

  const dirty = sel !== null && sel.source === "custom" && text !== saved;

  return (
    <Stack gap="md" className="skills-page">
      {list?.admin && (
        <div className="skills-row">
          <Button
            size="sm"
            variant={scope === "mine" ? "primary" : "default"}
            onClick={() => setScope("mine")}
          >
            My skills
          </Button>
          <Button
            size="sm"
            variant={scope === "default" ? "primary" : "default"}
            onClick={() => setScope("default")}
          >
            Default skills (admin)
          </Button>
        </div>
      )}
      <Text variant="dimmed">
        {scope === "default"
          ? "These are the shared defaults everyone gets unless they have their own skill of the same name."
          : "These are your own skills. A skill of yours replaces a default of the same name for you only. Delete it to go back to the default."}
      </Text>
      {msg && (
        <Alert variant={msg.error ? "error" : "success"}>{msg.text}</Alert>
      )}

      <div className="skills-editor">
        <div className="skills-editor__list">
          {list?.skills.map((s) => (
            <div key={s.name} className="skills-editor__skill">
              <div className="skills-row">
                <strong>{s.name}</strong>
                {s.source === "default" && (
                  <span className="skills-badge">default</span>
                )}
              </div>
              <ul>
                {s.files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={`skills-editor__file${
                        sel?.skill === s.name && sel.path === f.path
                          ? " skills-editor__file--active"
                          : ""
                      }`}
                      onClick={() => open(s.name, f.path, s.source)}
                    >
                      {f.path}
                    </button>
                  </li>
                ))}
              </ul>
              {s.source === "custom" && (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => {
                    const msg = s.overridesDefault
                      ? `Remove your override of "${s.name}" and restore the default?`
                      : `Delete the whole skill "${s.name}"?`;
                    if (confirm(msg))
                      void run(
                        async () => {
                          await api({
                            op: "deleteSkill",
                            scope,
                            skill: s.name,
                          });
                          setSel(null);
                          setText("");
                          setSaved("");
                          await refresh();
                        },
                        s.overridesDefault ? "Restored to default." : "Deleted."
                      );
                  }}
                >
                  {s.overridesDefault ? "Restore default" : "Delete skill"}
                </Button>
              )}
            </div>
          ))}

          <TextInput
            label={
              <LabelWithTip tip="Lowercase letters, numbers and single hyphens. Use the name of a default skill (for example skola) to replace it for you only.">
                New skill
              </LabelWithTip>
            }
            placeholder="skill-name"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value.toLowerCase())}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!newName}
            onClick={() => {
              void save(newName, "SKILL.md", TEMPLATE(newName)).then(() =>
                setNewName("")
              );
            }}
          >
            Create
          </Button>
          {sel?.source === "custom" && (
            <>
              <TextInput
                label={`New file in ${sel.skill}`}
                placeholder="references/notes.md"
                value={newPath}
                onChange={(e) => setNewPath(e.currentTarget.value)}
              />
              <Button
                size="sm"
                disabled={!newPath}
                onClick={() => {
                  void save(sel.skill, newPath, "# Notes\n").then(() =>
                    setNewPath("")
                  );
                }}
              >
                Add file
              </Button>
            </>
          )}
        </div>

        <div className="skills-editor__main">
          {sel ? (
            <>
              <Text weight="semibold">
                {sel.skill}/{sel.path}
                {sel.source === "default"
                  ? " (read-only — create a skill with this name to override)"
                  : dirty
                    ? " (unsaved changes)"
                    : ""}
              </Text>
              <Textarea
                value={text}
                onChange={(e) =>
                  sel.source === "custom" && setText(e.currentTarget.value)
                }
                readOnly={sel.source === "default"}
                spellCheck={false}
                minRows={22}
                className="skills-editor__text"
              />
              {sel.source === "custom" && (
                <div className="skills-row">
                  <Button
                    variant="primary"
                    disabled={!dirty}
                    onClick={() => save(sel.skill, sel.path, text)}
                  >
                    Save
                  </Button>
                  <Button
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
                  </Button>
                  {sel.path !== "SKILL.md" && (
                    <Button
                      variant="destructive"
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
                            setSaved("");
                            await refresh();
                          }, "Deleted.");
                      }}
                    >
                      Delete file
                    </Button>
                  )}
                </div>
              )}
              {versions && (
                <div>
                  <Text weight="semibold">Earlier versions</Text>
                  {versions.length === 0 && (
                    <Text variant="dimmed">No earlier versions.</Text>
                  )}
                  <ul className="skills-editor__versions">
                    {versions.map((v) => (
                      <li key={v.id}>
                        {new Date(v.savedAt).toLocaleString()}
                        <Button size="xs" onClick={() => setText(v.content)}>
                          Load into editor
                        </Button>
                        <Button
                          size="xs"
                          onClick={() =>
                            run(async () => {
                              await api({
                                op: "restore",
                                scope,
                                skill: sel.skill,
                                path: sel.path,
                                versionId: v.id,
                              });
                              await open(sel.skill, sel.path, sel.source);
                            }, "Restored.")
                          }
                        >
                          Restore
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <Text variant="dimmed">Pick a file to edit.</Text>
          )}
        </div>
      </div>
    </Stack>
  );
}
