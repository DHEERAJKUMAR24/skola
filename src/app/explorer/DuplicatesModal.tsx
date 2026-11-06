import { InfoTip } from "@/components/InfoTip/InfoTip";
import ModalProps from "@/components/ModalProps";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Text } from "@/components/ui/Text";
import { db } from "@/logic/db";
import {
  DEFAULT_THRESHOLD,
  type DupItem,
  type FindResult,
  findDuplicateGroups,
  sidesOfContent,
} from "@/logic/duplicates/similarity";
import { deleteNote } from "@/logic/note/deleteNote";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const LEVELS = [
  { value: "0.9", label: "Near copies (90%+)" },
  { value: String(DEFAULT_THRESHOLD), label: "Same fact, other words (72%+)" },
  { value: "0.6", label: "Related, review first (60%+)" },
];

const column = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--spacing-sm)",
  minWidth: "min(560px, 100%)",
} as const;
const row = {
  display: "flex",
  gap: "var(--spacing-xs)",
  alignItems: "center",
  flexWrap: "wrap",
} as const;

interface Props extends ModalProps {
  /** Only notes in these decks; undefined means every deck. */
  deckIds?: Set<string>;
}

/**
 * Finds notes that repeat each other, on this device and with no network: exact copies and the
 * same fact in other words (the same engine as the find_similar_cards assistant tool). It never
 * deletes without a second click on one note.
 */
export default function DuplicatesModal({ opened, setOpened, deckIds }: Props) {
  const navigate = useNavigate();
  const [level, setLevel] = useState(String(DEFAULT_THRESHOLD));
  const [result, setResult] = useState<FindResult | null>(null);
  const [text, setText] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setConfirm(null);
    // Let the message paint before the (time-limited) search blocks the thread.
    await new Promise((r) => setTimeout(r, 30));
    const [notes, cards] = await Promise.all([
      db.notes.toArray(),
      db.cards.toArray(),
    ]);
    const reps = new Map<string, number>();
    for (const c of cards)
      reps.set(c.note, (reps.get(c.note) ?? 0) + (c.model?.reps ?? 0));
    const items: DupItem[] = [];
    const labels = new Map<string, string>();
    for (const n of notes) {
      if (deckIds && !deckIds.has(n.deck)) continue;
      const sides = sidesOfContent(n.content as Record<string, any>);
      if (!sides) continue;
      labels.set(n.id, n.sortField || sides.question);
      items.push({
        id: n.id,
        sides,
        weight: reps.get(n.id) ?? 0,
        created: new Date(n.creationDate).getTime(),
      });
    }
    setText(labels);
    setResult(findDuplicateGroups(items, { threshold: Number(level) }));
    setBusy(false);
  }, [level, deckIds]);

  useEffect(() => {
    if (opened) void run();
  }, [opened, run]);

  async function remove(id: string) {
    const note = await db.notes.get(id);
    if (note) await deleteNote(note);
    setConfirm(null);
    await run();
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={
        <>
          Find duplicates{" "}
          <InfoTip>
            Groups notes that ask the same thing, found on this device with no
            network. The suggested keeper has the most reviews, then is the
            oldest. If the others hold facts the keeper lacks, copy them into
            the keeper first. Deleting a note removes its cards and review
            history, so each delete asks twice.
          </InfoTip>
        </>
      }
    >
      <div style={column}>
        <Select
          label="How alike"
          value={level}
          onChange={setLevel}
          options={LEVELS}
        />
        {busy && <Text variant="dimmed">Searching...</Text>}
        {result && !busy && result.groups.length === 0 && (
          <Text variant="dimmed">No duplicates found at this level.</Text>
        )}
        {result?.truncated && (
          <Text variant="dimmed">
            Only part of the collection was searched
            {result.reason === "items" ? " (too many notes)" : " (time limit)"}.
            Pick a deck in the notes list and run it again.
          </Text>
        )}
        {!busy &&
          result?.groups.map((g) => (
            <div
              key={g.keep}
              style={{
                ...column,
                minWidth: 0,
                gap: "var(--spacing-xs)",
                border: "1px solid var(--theme-neutral-200)",
                borderRadius: "var(--radius-md, 8px)",
                padding: "var(--spacing-sm)",
              }}
            >
              <div style={row}>
                <Badge color="primary">
                  {Math.round(g.score * 100)}% alike
                </Badge>
                <Badge color="neutral">
                  {g.suggestion === "delete_duplicates"
                    ? "the others add nothing"
                    : "merge, then delete"}
                </Badge>
              </div>
              {g.missing_from_keep.length > 0 && (
                <Text size="sm" variant="dimmed">
                  Only in the others: {g.missing_from_keep.join(", ")}
                </Text>
              )}
              {g.ids.map((id) => (
                <div key={id} style={row}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {id === g.keep && <strong>Keep: </strong>}
                    {text.get(id)}
                  </span>
                  <Button
                    size="xs"
                    onClick={() => {
                      setOpened(false);
                      navigate(`/notes?note=${id}`);
                    }}
                  >
                    Open
                  </Button>
                  {id !== g.keep &&
                    (confirm === id ? (
                      <Button
                        size="xs"
                        variant="destructive"
                        onClick={() => void remove(id)}
                      >
                        Really delete
                      </Button>
                    ) : (
                      <Button size="xs" onClick={() => setConfirm(id)}>
                        Delete
                      </Button>
                    ))}
                </div>
              ))}
            </div>
          ))}
      </div>
    </Modal>
  );
}
