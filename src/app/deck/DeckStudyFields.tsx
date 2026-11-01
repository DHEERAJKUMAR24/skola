import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Button, NumberInput, Switch, Text } from "@/components/ui";
import { Select } from "@/components/ui/Select";
import type { ExamForm, ExamFormErrors } from "@/logic/deck/examForm";
import type { StudyPreset } from "@/logic/deck/presets";
import "./DeckStudyFields.css";

const BASE = "deck-study";

interface Props {
  presets: StudyPreset[];
  /** "" means the deck still uses its own settings from before presets existed. */
  presetId: string;
  onPresetChange: (id: string) => void;
  /** Offer the "own settings" choice (an older deck that has no preset). */
  showLegacy: boolean;
  exam: ExamForm;
  examErrors: ExamFormErrors;
  onExamChange: (next: ExamForm) => void;
  /** The exam date this deck would use if it had none of its own. */
  inheritedExam?: { date: string; deckName: string };
  onManagePresets: () => void;
}

const timing = (p: StudyPreset) =>
  p.schedulingMode === "daily" ? "whole days" : "exact time";

/** What a preset means in one line, so the choice is not a black box. */
export const summarize = (p: StudyPreset) =>
  `${p.newCardsPerDay} new and up to ${p.maxReviewsPerDay} reviews a day, ${Math.round(p.desiredRetention * 100)}% retention, ${timing(p)}`;

/** The study settings of a deck: which preset it follows, and an optional exam date. */
export default function DeckStudyFields({
  presets,
  presetId,
  onPresetChange,
  showLegacy,
  exam,
  examErrors,
  onExamChange,
  inheritedExam,
  onManagePresets,
}: Props) {
  const selected = presets.find((p) => p.id === presetId);

  return (
    <>
      <section className={BASE} data-tour="deck-preset">
        <div className={`${BASE}__head`}>
          <span className={`${BASE}__title`}>Study settings</span>
          <span className={`${BASE}__badge`}>FSRS-6</span>
        </div>
        <Select
          label={
            <LabelWithTip tip="A preset is a shared group of study settings: daily limits, how much you want to remember, learning steps and more. Decks that use the same preset change together.">
              Preset
            </LabelWithTip>
          }
          value={presetId}
          options={[
            ...(showLegacy
              ? [{ value: "", label: "This deck's own settings (older deck)" }]
              : []),
            ...presets.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={onPresetChange}
        />
        <Text size="sm" variant="dimmed">
          {selected
            ? summarize(selected)
            : "This deck uses settings saved on the deck itself. Pick a preset to manage them in one place."}
        </Text>
        <div className={`${BASE}__row`}>
          <Button variant="default" onClick={onManagePresets}>
            Edit presets
          </Button>
        </div>
      </section>

      <section className={BASE} data-tour="deck-exam">
        <div className={`${BASE}__head`}>
          <span className={`${BASE}__title`}>Exam or test date</span>
          <span className={`${BASE}__badge ${BASE}__badge--optional`}>
            Optional
          </span>
        </div>
        <Text size="sm" variant="dimmed">
          Every card is planned to be seen again before this day, and reviews
          get a little more frequent as it gets close. Sub-decks use this date
          too, unless they set their own.
        </Text>
        <div className={`${BASE}__row`}>
          <input
            type="date"
            className={`${BASE}__date`}
            aria-label="Exam date"
            value={exam.examDate}
            onChange={(e) =>
              onExamChange({ ...exam, examDate: e.currentTarget.value })
            }
          />
          {exam.examDate && (
            <Button
              variant="default"
              onClick={() => onExamChange({ ...exam, examDate: "" })}
            >
              Clear
            </Button>
          )}
        </div>
        {examErrors.examDate && (
          <Text size="sm" style={{ color: "var(--theme-red-600)" }}>
            {examErrors.examDate}
          </Text>
        )}
        {!exam.examDate && inheritedExam && (
          <Text size="sm" variant="dimmed">
            Using {inheritedExam.deckName}'s exam date: {inheritedExam.date}.
          </Text>
        )}
        {exam.examDate && (
          <div className={`${BASE}__custom`}>
            <NumberInput
              label={
                <LabelWithTip tip="Cards are scheduled to come up at least this many days before the exam, so you get one last look.">
                  Last review before the exam (days)
                </LabelWithTip>
              }
              value={exam.examBufferDays}
              min={0}
              max={30}
              error={examErrors.examBufferDays}
              onChange={(v) =>
                onExamChange({ ...exam, examBufferDays: String(v) })
              }
            />
            <Switch
              label={
                <LabelWithTip tip="Raises your desired retention gradually over the last 45 days, so cards come back a little sooner as the exam gets close.">
                  Review more often as the exam gets close
                </LabelWithTip>
              }
              checked={exam.examRamp}
              onChange={(e) =>
                onExamChange({ ...exam, examRamp: e.currentTarget.checked })
              }
            />
          </div>
        )}
      </section>
    </>
  );
}
