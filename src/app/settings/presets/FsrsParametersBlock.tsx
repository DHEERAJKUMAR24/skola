import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Button, Text } from "@/components/ui";
import { db } from "@/logic/db";
import { type StudyPreset, savePreset } from "@/logic/deck/presets";
import {
  MIN_OPTIMIZE_REVIEWS,
  buildTrainingSet,
  optimizeWeights,
} from "@/logic/fsrs/optimizer";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Rating, default_w } from "ts-fsrs";

/** The preset's FSRS parameters: defaults, or trained from your own review history. */
export default function FsrsParametersBlock({
  preset,
}: { preset: StudyPreset }) {
  const [newDayStartHour] = useSetting("#newDayStartHour");
  const reviewCount = useLiveQuery(async () => {
    const logs = await db.reviewLogs.toArray();
    return logs.filter((l) => l.rating !== Rating.Manual).length;
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const enough = (reviewCount ?? 0) >= MIN_OPTIMIZE_REVIEWS;
  const info = preset.weightsInfo;

  async function optimize() {
    setBusy(true);
    setMessage(null);
    try {
      const logs = await db.reviewLogs.toArray();
      const weights = await optimizeWeights(logs, {
        shortTerm: preset.schedulingMode === "exact",
        relearningSteps: preset.relearningSteps.length,
        newDayStartHour,
      });
      const reviews = buildTrainingSet(logs, newDayStartHour).reviews;
      await savePreset({
        ...preset,
        weights,
        weightsInfo: { trainedAt: Date.now(), reviews },
      });
      setMessage({
        ok: true,
        text: `Trained on ${reviews} reviews. New intervals use your parameters.`,
      });
    } catch (e) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="presets__params">
      <span className="presets__label">
        <LabelWithTip
          tip={
            <>
              FSRS predicts when you will forget a card using 21 numbers. The
              defaults suit an average learner. Optimizing trains them on your
              own review history, so intervals fit how <em>you</em> forget.
              Re-run it every few months.
            </>
          }
        >
          FSRS parameters
        </LabelWithTip>
      </span>
      <Text size="sm" variant="dimmed">
        {preset.weights && info
          ? `Personalised from ${info.reviews} reviews on ${new Date(info.trainedAt).toLocaleDateString()}.`
          : "Using the default FSRS-6 parameters."}{" "}
        You have {reviewCount ?? 0} reviews
        {enough ? "." : `; ${MIN_OPTIMIZE_REVIEWS} are needed to train.`}
      </Text>
      <div className="presets__row">
        <Button variant="primary" disabled={busy || !enough} onClick={optimize}>
          {busy ? "Training..." : "Optimize from my reviews"}
        </Button>
        {preset.weights && (
          <Button
            variant="default"
            disabled={busy}
            onClick={() =>
              savePreset({
                ...preset,
                weights: undefined,
                weightsInfo: undefined,
              })
            }
          >
            Reset to defaults
          </Button>
        )}
      </div>
      {message && (
        <output className={message.ok ? "presets__ok" : "presets__error"}>
          {message.text}
        </output>
      )}
      <details className="presets__details">
        <summary>Show the 21 values</summary>
        <code>
          {(preset.weights ?? default_w).map((w) => +w.toFixed(4)).join(", ")}
        </code>
      </details>
    </div>
  );
}
