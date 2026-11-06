import { Button } from "@/components/ui";
import { Select } from "@/components/ui/Select";
import { setSuspended } from "@/logic/card/cardControls";
import { db } from "@/logic/db";
import type { Deck } from "@/logic/deck/deck";
import { decksWithPaths } from "@/logic/deck/deckPath";
import { moveNotes } from "@/logic/note/moveNotes";
import { addTag, normalizeTag, removeTag } from "@/logic/note/tags";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import "./NoteBulkBar.css";

const BASE = "note-bulk-bar";

interface Props {
  selectedIds: string[];
  decks: Deck[] | undefined;
}

/** Actions for the selected notes. Moving or tagging never changes a card's FSRS state or history. */
export function NoteBulkBar({ selectedIds, decks }: Props) {
  const [tagText, setTagText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const deckOptions = useMemo(
    () => [
      { value: "", label: "Move to deck..." },
      ...decksWithPaths(decks ?? []).map(({ deck, path }) => ({
        value: deck.id,
        label: path,
      })),
    ],
    [decks]
  );

  const selectedNotes = useLiveQuery(
    () => db.notes.bulkGet(selectedIds),
    [selectedIds.join(",")]
  );
  const usedTags = useMemo(
    () =>
      [...new Set((selectedNotes ?? []).flatMap((n) => n?.tags ?? []))].sort(),
    [selectedNotes]
  );

  const count = selectedIds.length;
  const plural = count === 1 ? "note" : "notes";

  async function run(action: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  function addTagToSelection() {
    const tag = tagText;
    if (!normalizeTag(tag)) return;
    setTagText("");
    void run(async () => {
      for (const id of selectedIds) await addTag(id, tag);
    }, `Tagged ${count} ${plural}.`);
  }

  /** Every card of the selected notes, as bulk_update_cards does over MCP. */
  function suspendSelection(suspended: boolean) {
    void run(
      async () => {
        const cards = await db.cards.where("note").anyOf(selectedIds).toArray();
        for (const c of cards) await setSuspended(c.id, suspended);
      },
      suspended
        ? `Suspended the cards of ${count} ${plural}. They are not studied until you unsuspend them.`
        : `Unsuspended the cards of ${count} ${plural}.`
    );
  }

  return (
    <div
      className={BASE}
      role="toolbar"
      aria-label="Actions for selected notes"
    >
      <strong>
        {count} {plural} selected
      </strong>

      <Select
        value=""
        options={deckOptions}
        onChange={(deckId) =>
          deckId &&
          run(
            () => moveNotes(selectedIds, deckId),
            `Moved ${count} ${plural}. Their FSRS progress is unchanged.`
          )
        }
      />

      <div className={`${BASE}__tag`}>
        <input
          className={`${BASE}__input`}
          value={tagText}
          placeholder="Tag to add"
          aria-label="Tag to add"
          onChange={(e) => setTagText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTagToSelection();
          }}
        />
        <Button
          variant="default"
          disabled={!normalizeTag(tagText)}
          onClick={addTagToSelection}
        >
          Add tag
        </Button>
      </div>

      {usedTags.length > 0 && (
        <Select
          value=""
          options={[
            { value: "", label: "Remove tag..." },
            ...usedTags.map((t) => ({ value: t, label: t })),
          ]}
          onChange={(tag) =>
            tag &&
            run(async () => {
              for (const id of selectedIds) await removeTag(id, tag);
            }, `Removed "${tag}" from ${count} ${plural}.`)
          }
        />
      )}

      <Button variant="default" onClick={() => suspendSelection(true)}>
        Suspend
      </Button>
      <Button variant="default" onClick={() => suspendSelection(false)}>
        Unsuspend
      </Button>

      {message && <output className={`${BASE}__message`}>{message}</output>}
    </div>
  );
}
