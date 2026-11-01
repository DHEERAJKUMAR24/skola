import SelectDecksHeader from "@/components/SelectDecksHeader";
import { TextInput } from "@/components/ui";
import { Select } from "@/components/ui/Select";
import { Deck } from "@/logic/deck/deck";
import { IconSearch } from "@tabler/icons-react";
import "./NoteExplorerControls.css";

interface NoteExplorerControlsProps {
  decks: Deck[] | undefined;
  selectedDeckParam: string;
  onDeckSelect: (deckId: string | null) => void;
  filterValue: string;
  onFilterChange: (value: string) => void;
  tags?: { tag: string; count: number }[];
  selectedTag: string;
  onTagSelect: (tag: string | null) => void;
}

export function NoteExplorerControls({
  decks,
  selectedDeckParam,
  onDeckSelect,
  filterValue,
  onFilterChange,
  tags,
  selectedTag,
  onTagSelect,
}: NoteExplorerControlsProps) {
  return (
    <div className="note-explorer-controls">
      <SelectDecksHeader
        label="Showing Notes in"
        decks={decks}
        selectedValue={selectedDeckParam}
        onSelect={onDeckSelect}
      />

      {tags && tags.length > 0 && (
        <Select
          label="Tag"
          value={selectedTag}
          options={[
            { value: "", label: "All tags" },
            ...tags.map((t) => ({
              value: t.tag,
              label: `${t.tag} (${t.count})`,
            })),
          ]}
          onChange={(v) => onTagSelect(v || null)}
        />
      )}

      <TextInput
        leftSection={<IconSearch size={16} />}
        value={filterValue}
        placeholder="Filter Notes"
        onChange={(event) => onFilterChange(event.currentTarget.value)}
      />
    </div>
  );
}
