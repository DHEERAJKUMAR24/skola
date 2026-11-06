import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { TextInput } from "@/components/ui/TextInput";
import { db } from "@/logic/db";
import { orphansFirst } from "@/logic/master/builderOps";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";

export interface CardChoice {
  id: string;
  /** Text of the card's note, plain. */
  text: string;
  deck: string;
}

const SHOWN = 100;

/** Cards of one deck (or of every deck) with the text of their note. Master cards are left out. */
export async function listCardChoices(
  deckId: string | null
): Promise<CardChoice[]> {
  const cards = deckId
    ? await db.cards.where("deck").equals(deckId).toArray()
    : await db.cards.toArray();
  const notes = await db.notes.bulkGet([...new Set(cards.map((c) => c.note))]);
  const byId = new Map(notes.flatMap((n) => (n ? [[n.id, n] as const] : [])));
  return cards.flatMap((c) => {
    const n = byId.get(c.note);
    if (!n || n.content?.type === "master") return [];
    return [{ id: c.id, text: n.sortField || "(no text)", deck: c.deck }];
  });
}

/**
 * Pick a card to link an entry to. Any card of any deck can be linked (ADR 0014); the box
 * limits the search to the master's own deck until "all decks" is ticked.
 */
export default function CardPickerModal({
  opened,
  onClose,
  deckId,
  onPick,
  orphanIds,
  defaultAllDecks = false,
  title = "Link to a card",
}: {
  opened: boolean;
  onClose: () => void;
  deckId: string;
  onPick: (cardId: string) => void;
  /** Cards that no entry links to yet: listed first and marked. */
  orphanIds?: Set<string>;
  defaultAllDecks?: boolean;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [allDecks, setAllDecks] = useState(defaultAllDecks);
  const choices = useLiveQuery(
    () => (opened ? listCardChoices(allDecks ? null : deckId) : []),
    [opened, allDecks, deckId]
  );
  const q = query.trim().toLowerCase();
  const hits = orphansFirst(
    (choices ?? [])
      .filter((c) => !q || c.text.toLowerCase().includes(q))
      .map((c) => ({ ...c, orphan: !!orphanIds?.has(c.id) }))
  );

  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack gap="md">
        <TextInput
          label="Search"
          placeholder="Part of the card text"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-xs)",
          }}
        >
          <Checkbox
            checked={allDecks}
            onChange={(e) => setAllDecks(e.currentTarget.checked)}
            label="Search all decks"
          />
          <InfoTip>
            An entry may point at a card in another deck. Coverage still only
            counts the cards of the master's own deck.
          </InfoTip>
        </div>
        <Stack gap="xs">
          {hits.slice(0, SHOWN).map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                gap: "var(--spacing-sm)",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text>
                {c.orphan && (
                  <Badge size="sm" color="orange">
                    not in master
                  </Badge>
                )}{" "}
                {c.text}
              </Text>
              <Button
                size="sm"
                onClick={() => {
                  onPick(c.id);
                  onClose();
                }}
              >
                Link
              </Button>
            </div>
          ))}
          {hits.length === 0 && <Text variant="dimmed">No cards found.</Text>}
          {hits.length > SHOWN && (
            <Text variant="dimmed">
              Showing the first {SHOWN} of {hits.length}. Type to narrow it
              down.
            </Text>
          )}
        </Stack>
      </Stack>
    </Modal>
  );
}
