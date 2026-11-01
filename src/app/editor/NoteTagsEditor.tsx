import { db } from "@/logic/db";
import { normalizeTags, setNoteTags, useAllTags } from "@/logic/note/tags";
import { IconX } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useId, useState } from "react";
import "./NoteTagsEditor.css";

const BASE = "note-tags";

/** Edits one note's tags. Changes are saved straight away and never touch the cards' FSRS state. */
export default function NoteTagsEditor({ noteId }: { noteId: string }) {
  const note = useLiveQuery(() => db.notes.get(noteId), [noteId]);
  const allTags = useAllTags();
  const [text, setText] = useState("");
  const listId = useId();
  const tags = note?.tags ?? [];

  async function add(raw: string) {
    const clean = normalizeTags(raw.split(","));
    setText("");
    if (clean.length) await setNoteTags(noteId, [...tags, ...clean]);
  }

  return (
    <div className={BASE}>
      <span className={`${BASE}__label`}>Tags</span>
      <div className={`${BASE}__list`}>
        {tags.map((tag) => (
          <span key={tag} className={`${BASE}__chip`}>
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              className={`${BASE}__remove`}
              onClick={() =>
                setNoteTags(
                  noteId,
                  tags.filter((t) => t !== tag)
                )
              }
            >
              <IconX size={12} />
            </button>
          </span>
        ))}
        <input
          className={`${BASE}__input`}
          list={listId}
          value={text}
          placeholder={tags.length ? "Add tag" : "Add a tag, e.g. closures"}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              void add(text);
            } else if (e.key === "Backspace" && !text && tags.length) {
              void setNoteTags(noteId, tags.slice(0, -1));
            }
          }}
          onBlur={() => text.trim() && void add(text)}
        />
        <datalist id={listId}>
          {allTags
            ?.filter((t) => !tags.includes(t.tag))
            .map((t) => (
              <option key={t.tag} value={t.tag} />
            ))}
        </datalist>
      </div>
    </div>
  );
}
