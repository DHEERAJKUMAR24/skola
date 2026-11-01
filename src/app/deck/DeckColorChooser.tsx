import { InputLabel } from "@/components/ui/InputLabel";
import { COLORS, ColorIdentifier } from "@/lib/ColorIdentifier";
import { IconCheck } from "@tabler/icons-react";
import "./DeckColorChooser.css";

const BASE = "deck-color-chooser";

const NAMES: Record<ColorIdentifier, string> = {
  sky: "Blue",
  red: "Red",
  orange: "Orange",
  lime: "Green",
  fuchsia: "Purple",
};

interface DeckColorChooserProps {
  deckColor: ColorIdentifier;
  setDeckColor: (color: ColorIdentifier) => void;
}

export default function DeckColorChooser({
  deckColor,
  setDeckColor,
}: DeckColorChooserProps) {
  return (
    <div className={BASE}>
      <InputLabel>Deck Color</InputLabel>
      <div
        className={`${BASE}__color-options`}
        role="radiogroup"
        aria-label="Deck color"
      >
        {COLORS.map((color) => {
          const selected = color === deckColor;
          return (
            <button
              type="button"
              key={color}
              role="radio"
              aria-checked={selected}
              aria-label={NAMES[color]}
              title={NAMES[color]}
              className={`${BASE}__color-button ${selected ? `${BASE}__color-button--selected` : ""}`}
              style={{
                backgroundColor: `light-dark(var(--theme-${color}-400), var(--theme-${color}-300))`,
                borderColor: `light-dark(var(--theme-${color}-600), var(--theme-${color}-200))`,
              }}
              onClick={() => setDeckColor(color)}
            >
              {selected && <IconCheck size={18} stroke={3} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
