import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Button, Text } from "@/components/ui";
import { Select } from "@/components/ui/Select";
import { db } from "@/logic/db";
import {
  DEFAULT_PRESET_ID,
  createPreset,
  deletePreset,
  ensureDefaultPreset,
  usePresets,
} from "@/logic/deck/presets";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import PresetEditor from "./PresetEditor";
import "./StudyPresets.css";

/** Settings tab to create, edit and delete study presets, the shared settings decks follow. */
export default function StudyPresetsView() {
  const presets = usePresets();
  const [selectedId, setSelectedId] = useState(DEFAULT_PRESET_ID);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureDefaultPreset();
  }, []);

  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const d of await db.decks.toArray()) {
      const id = d.options?.presetId ?? "";
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, []);

  const selected = presets?.find((p) => p.id === selectedId) ?? presets?.[0];
  if (!presets || !selected)
    return <Text variant="dimmed">Loading presets...</Text>;
  const legacy = counts?.get("") ?? 0;

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="presets" data-tour="presets-root">
      <div className="presets__intro">
        <span className="presets__label">
          <LabelWithTip
            tip={
              <>
                A preset is a named group of study settings. Give a preset to
                many decks and change it once to change them all. Pick a preset
                for each deck when you create or edit it.
              </>
            }
          >
            Study presets
          </LabelWithTip>
        </span>
        <Text size="sm" variant="dimmed">
          Everything about how cards are scheduled: daily limits, FSRS memory
          settings, learning steps, easy days and leeches.
        </Text>
        {legacy > 0 && (
          <Text size="sm" variant="dimmed">
            {legacy} older {legacy === 1 ? "deck has" : "decks have"} its own
            settings and no preset. Edit the deck to choose a preset.
          </Text>
        )}
      </div>

      <div className="presets__bar" data-tour="presets-picker">
        <Select
          label="Preset"
          value={selected.id}
          options={presets.map((p) => ({
            value: p.id,
            label: `${p.name} (${counts?.get(p.id) ?? 0})`,
          }))}
          onChange={(id) => {
            setSelectedId(id);
            setConfirmDelete(false);
          }}
        />
        <Button
          variant="default"
          onClick={() =>
            act(async () => setSelectedId(await createPreset("New preset")))
          }
        >
          New
        </Button>
        <Button
          variant="default"
          onClick={() =>
            act(async () =>
              setSelectedId(
                await createPreset(`${selected.name} copy`, selected)
              )
            )
          }
        >
          Duplicate
        </Button>
        {selected.id !== DEFAULT_PRESET_ID && (
          <Button
            variant={confirmDelete ? "destructive" : "default"}
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              setConfirmDelete(false);
              act(async () => {
                await deletePreset(selected.id);
                setSelectedId(DEFAULT_PRESET_ID);
              });
            }}
          >
            {confirmDelete ? "Click again to delete" : "Delete"}
          </Button>
        )}
      </div>
      {error && <output className="presets__error">{error}</output>}

      <PresetEditor
        key={selected.id}
        preset={selected}
        deckCount={counts?.get(selected.id) ?? 0}
      />
    </div>
  );
}
