import {
  Button,
  NumberInput,
  SegmentedControl,
  Switch,
  Text,
  TextInput,
} from "@/components/ui";
import {
  type FsrsFormErrors,
  type FsrsFormState,
  PRESETS,
  type PresetId,
  applyPreset,
  toFormState,
} from "@/logic/deck/fsrsOptions";
import "./DeckFsrsFields.css";

const BASE = "deck-fsrs";

interface Props {
  state: FsrsFormState;
  errors: FsrsFormErrors;
  onChange: (next: FsrsFormState) => void;
}

/** Memory (FSRS-6) settings for a deck: three presets, or every value by hand. */
export default function DeckFsrsFields({ state, errors, onChange }: Props) {
  const set = (patch: Partial<FsrsFormState>) =>
    onChange({ ...state, ...patch, preset: "custom" });

  const choose = (id: string) =>
    onChange(
      id === "custom"
        ? { ...state, preset: "custom" }
        : applyPreset(id as Exclude<PresetId, "custom">)
    );

  const hint =
    PRESETS.find((p) => p.id === state.preset)?.hint ??
    "Set every value yourself. You can switch back to a preset at any time.";

  return (
    <section className={BASE}>
      <div className={`${BASE}__head`}>
        <span className={`${BASE}__title`}>Memory settings</span>
        <span className={`${BASE}__badge`}>FSRS-6</span>
      </div>
      <Text size="sm" variant="dimmed">
        FSRS picks the best moment to show each card again. Choose how much you
        want to remember.
      </Text>

      <SegmentedControl
        value={state.preset}
        onChange={choose}
        data={[
          ...PRESETS.map((p) => ({
            value: p.id,
            label: `${p.label} ${Math.round(p.retention * 100)}%`,
          })),
          { value: "custom", label: "Custom" },
        ]}
      />
      <Text size="sm" variant="dimmed">
        {hint}
      </Text>

      {state.preset === "custom" && (
        <div className={`${BASE}__custom`}>
          <NumberInput
            label="Desired retention (%)"
            description="Chance you still remember a card when it comes due. Higher means more reviews."
            value={state.retentionPct}
            min={70}
            max={99}
            error={errors.retention}
            onChange={(v) => set({ retentionPct: String(v) })}
          />
          <NumberInput
            label="Maximum interval (days)"
            description="No card waits longer than this between reviews."
            value={state.maximumInterval}
            min={1}
            max={36500}
            error={errors.maximumInterval}
            onChange={(v) => set({ maximumInterval: String(v) })}
          />
          <TextInput
            label="Learning steps"
            description="Short repeats for a new card before FSRS takes over, e.g. 1m 10m. Leave empty to skip."
            value={state.learningSteps}
            error={errors.learningSteps}
            onChange={(e) => set({ learningSteps: e.currentTarget.value })}
          />
          <TextInput
            label="Relearning steps"
            description="Short repeats after you forget a card, e.g. 10m."
            value={state.relearningSteps}
            error={errors.relearningSteps}
            onChange={(e) => set({ relearningSteps: e.currentTarget.value })}
          />
          <Switch
            label="Fuzz"
            description="Vary intervals slightly so cards do not all fall due on the same day."
            checked={state.enableFuzz}
            onChange={(e) => set({ enableFuzz: e.currentTarget.checked })}
          />
          <Button variant="default" onClick={() => onChange(toFormState())}>
            Reset to defaults
          </Button>
        </div>
      )}
    </section>
  );
}
