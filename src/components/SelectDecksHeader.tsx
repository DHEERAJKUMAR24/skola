import { Deck } from "@/logic/deck/deck";
import { decksWithPaths } from "@/logic/deck/deckPath";
import { Combobox } from "./ui";

interface SelectDecksHeaderProps {
  label: string;
  disableAll?: boolean;
  decks?: Deck[];
  selectedValue?: string;
  onSelect: (deckId: string | null) => void;
}

export default function SelectDecksHeader({
  decks,
  label,
  disableAll,
  selectedValue = "",
  onSelect,
}: SelectDecksHeaderProps) {
  return (
    <Combobox
      label={label}
      searchable
      nothingFoundMessage="No Decks Found"
      data={(disableAll ? [] : [{ value: "", label: "All" }]).concat(
        decksWithPaths(decks ?? []).map(({ deck, path }) => ({
          value: deck.id,
          label: path,
        }))
      )}
      value={selectedValue}
      onChange={(value) => onSelect(value)}
    />
  );
}
