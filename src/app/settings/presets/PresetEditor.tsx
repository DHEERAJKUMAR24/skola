import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import {
  Button,
  NumberInput,
  SegmentedControl,
  Switch,
  Text,
  TextInput,
} from "@/components/ui";
import { Select } from "@/components/ui/Select";
import { db } from "@/logic/db";
import {
  type PresetForm,
  fromPresetForm,
  toPresetForm,
} from "@/logic/deck/presetForm";
import {
  type StudyPreset,
  assignPreset,
  savePreset,
} from "@/logic/deck/presets";
import { useEffect, useMemo, useRef, useState } from "react";
import FsrsParametersBlock from "./FsrsParametersBlock";
import WorkloadSimulator from "./WorkloadSimulator";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="presets__section">
      <h4>{title}</h4>
      <div className="presets__fields">{children}</div>
    </section>
  );
}

interface Props {
  preset: StudyPreset;
  deckCount: number;
}

/** Edits one study preset. Nothing changes until Save, and every field explains itself. */
export default function PresetEditor({ preset, deckCount }: Props) {
  const [form, setForm] = useState<PresetForm>(() => toPresetForm(preset));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [confirmApply, setConfirmApply] = useState(false);

  const saved = useMemo(() => toPresetForm(preset), [preset]);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  // Follow outside changes (sync, optimizer) unless the user is in the middle of editing.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setForm(saved);
  }, [saved]);

  const parsed = useMemo(() => fromPresetForm(form, preset), [form, preset]);
  const errors = "errors" in parsed ? parsed.errors : {};
  const set = (patch: Partial<PresetForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!("preset" in parsed)) return;
    try {
      await savePreset(parsed.preset);
      setMessage({
        ok: true,
        text: "Saved. Decks using this preset follow it now.",
      });
    } catch (e) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function applyToAll() {
    if (!confirmApply) return setConfirmApply(true);
    setConfirmApply(false);
    const ids = (await db.decks.toArray()).map((d) => d.id);
    await assignPreset(preset.id, ids);
    setMessage({
      ok: true,
      text: `All ${ids.length} decks now use this preset.`,
    });
  }

  const toggleDay = (d: number) =>
    set({
      easyDays: form.easyDays.includes(d)
        ? form.easyDays.filter((x) => x !== d)
        : [...form.easyDays, d],
    });

  return (
    <div className="presets__editor">
      <TextInput
        label="Preset name"
        value={form.name}
        error={errors.name}
        onChange={(e) => set({ name: e.currentTarget.value })}
      />

      <Section title="Daily limits">
        <NumberInput
          label={
            <LabelWithTip tip="The most new cards each deck shows per day. A sub-deck has its own count. Set 0 to stop new cards.">
              New cards per day
            </LabelWithTip>
          }
          value={form.newCardsPerDay}
          min={0}
          error={errors.newCardsPerDay}
          onChange={(v) => set({ newCardsPerDay: String(v) })}
        />
        <NumberInput
          label={
            <LabelWithTip tip="The most due reviews each deck shows per day. Extra cards wait for tomorrow. Set 0 to show none.">
              Maximum reviews per day
            </LabelWithTip>
          }
          value={form.maxReviewsPerDay}
          min={0}
          error={errors.maxReviewsPerDay}
          onChange={(v) => set({ maxReviewsPerDay: String(v) })}
        />
        <Select
          label={
            <LabelWithTip tip="Created: oldest cards first. Random: new cards are mixed up, the same way all day.">
              New card order
            </LabelWithTip>
          }
          value={form.newCardOrder}
          options={[
            { value: "created", label: "In the order they were created" },
            { value: "random", label: "Random" },
          ]}
          onChange={(v) =>
            set({ newCardOrder: v as PresetForm["newCardOrder"] })
          }
        />
      </Section>

      <Section title="Learning and timing">
        <div className="presets__field">
          <span className="presets__label">
            <LabelWithTip tip="Exact time: intervals count from the moment you answer, and steps like 10m are real minutes. Whole days: cards come due when a new day starts, like Anki, with no minute steps.">
              Review timing
            </LabelWithTip>
          </span>
          <SegmentedControl
            value={form.schedulingMode}
            onChange={(v) =>
              set({ schedulingMode: v as PresetForm["schedulingMode"] })
            }
            data={[
              { value: "exact", label: "Exact time" },
              { value: "daily", label: "Whole days" },
            ]}
          />
        </div>
        <TextInput
          label={
            <LabelWithTip tip="Short repeats for a new card before FSRS takes over, for example 1m 10m. Use m, h or d. Leave empty to skip. Ignored with whole-day timing.">
              Learning steps
            </LabelWithTip>
          }
          value={form.learningSteps}
          error={errors.learningSteps}
          disabled={form.schedulingMode === "daily"}
          onChange={(e) => set({ learningSteps: e.currentTarget.value })}
        />
        <TextInput
          label={
            <LabelWithTip tip="Short repeats after you forget a review card, for example 10m. Ignored with whole-day timing.">
              Relearning steps
            </LabelWithTip>
          }
          value={form.relearningSteps}
          error={errors.relearningSteps}
          disabled={form.schedulingMode === "daily"}
          onChange={(e) => set({ relearningSteps: e.currentTarget.value })}
        />
      </Section>

      <Section title="FSRS memory model">
        <NumberInput
          label={
            <LabelWithTip tip="How likely you want to remember a card on the day it comes due. 90% is a good balance. Higher means more reviews; lower means fewer reviews but more forgetting. Compare options in the simulator below.">
              Desired retention (%)
            </LabelWithTip>
          }
          value={form.retentionPct}
          min={70}
          max={99}
          error={errors.retention}
          onChange={(v) => set({ retentionPct: String(v) })}
        />
        <NumberInput
          label={
            <LabelWithTip tip="No card waits longer than this between reviews. 36500 days is 100 years, effectively no limit.">
              Maximum interval (days)
            </LabelWithTip>
          }
          value={form.maximumInterval}
          min={1}
          max={36500}
          error={errors.maximumInterval}
          onChange={(v) => set({ maximumInterval: String(v) })}
        />
        <Switch
          label={
            <LabelWithTip tip="Adds a small random shift to longer intervals so cards you learned together do not all come back on the same day.">
              Fuzz
            </LabelWithTip>
          }
          checked={form.enableFuzz}
          onChange={(e) => set({ enableFuzz: e.currentTarget.checked })}
        />
        <FsrsParametersBlock preset={preset} />
        <WorkloadSimulator
          preset={"preset" in parsed ? parsed.preset : preset}
        />
      </Section>

      <Section title="Easy days">
        <div className="presets__field">
          <span className="presets__label">
            <LabelWithTip tip="Reviews are moved up to 3 days earlier to avoid these weekdays (only for intervals of 3 days or more). Earlier is always safe for memory. Use it to keep a day free.">
              Days to keep light
            </LabelWithTip>
          </span>
          <div className="presets__days">
            {WEEKDAYS.map((name, d) => (
              <button
                key={name}
                type="button"
                aria-pressed={form.easyDays.includes(d)}
                className="presets__day"
                onClick={() => toggleDay(d)}
              >
                {name}
              </button>
            ))}
          </div>
          {errors.easyDays && (
            <output className="presets__error">{errors.easyDays}</output>
          )}
        </div>
      </Section>

      <Section title="Siblings and leeches">
        <Switch
          label={
            <LabelWithTip tip="After you answer a card, hide the other new cards made from the same note (for example the other side of a two-sided note) until tomorrow.">
              Bury new siblings
            </LabelWithTip>
          }
          checked={form.buryNewSiblings}
          onChange={(e) => set({ buryNewSiblings: e.currentTarget.checked })}
        />
        <Switch
          label={
            <LabelWithTip tip="Same, for sibling cards that are already in review.">
              Bury review siblings
            </LabelWithTip>
          }
          checked={form.buryReviewSiblings}
          onChange={(e) => set({ buryReviewSiblings: e.currentTarget.checked })}
        />
        <NumberInput
          label={
            <LabelWithTip tip="A card you forget this many times is a leech: a sign it needs rewording or splitting. It gets a leech tag, and again every half threshold after. Set 0 to turn off.">
              Leech threshold (lapses)
            </LabelWithTip>
          }
          value={form.leechThreshold}
          min={0}
          error={errors.leechThreshold}
          onChange={(v) => set({ leechThreshold: String(v) })}
        />
        <Select
          label={
            <LabelWithTip tip="Tag only: the note gets a leech tag and the card stays in study. Suspend and tag: the card is also hidden until you bring it back.">
              When a card becomes a leech
            </LabelWithTip>
          }
          value={form.leechAction}
          options={[
            { value: "tag", label: "Tag only" },
            { value: "suspend", label: "Suspend and tag" },
          ]}
          onChange={(v) => set({ leechAction: v as PresetForm["leechAction"] })}
        />
      </Section>

      <div className="presets__footer">
        <Button
          variant="primary"
          disabled={!dirty || !("preset" in parsed)}
          onClick={save}
        >
          Save preset
        </Button>
        <Button
          variant="default"
          disabled={!dirty}
          onClick={() => {
            setForm(saved);
            setMessage(null);
          }}
        >
          Revert
        </Button>
        <Button
          variant={confirmApply ? "primary" : "default"}
          onClick={applyToAll}
        >
          {confirmApply ? "Click again to confirm" : "Use for all decks"}
        </Button>
        <Text size="sm" variant="dimmed">
          Used by {deckCount} {deckCount === 1 ? "deck" : "decks"}.
        </Text>
        {message && (
          <output className={message.ok ? "presets__ok" : "presets__error"}>
            {message.text}
          </output>
        )}
      </div>
    </div>
  );
}
