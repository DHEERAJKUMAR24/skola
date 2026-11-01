import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Text } from "@/components/ui";
import type { StudyPreset } from "@/logic/deck/presets";
import { type SimResult, simulate } from "@/logic/fsrs/simulate";
import { useEffect, useState } from "react";
import { default_w } from "ts-fsrs";

const RETENTIONS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97];
const DAYS = 180;
const MAX_NEW = 40; // keeps the simulation quick

/** Shows how many reviews each retention level would mean, for this preset's new-card pace. */
export default function WorkloadSimulator({ preset }: { preset: StudyPreset }) {
  const [results, setResults] = useState<SimResult[]>([]);
  const newPerDay = Math.min(preset.newCardsPerDay, MAX_NEW);
  const weights = preset.weights ?? [...default_w];

  useEffect(() => {
    setResults([]);
    if (newPerDay <= 0) return;
    let cancelled = false;
    let i = 0;
    const out: SimResult[] = [];
    // One retention per tick so the page stays responsive.
    const step = () => {
      if (cancelled || i >= RETENTIONS.length) return;
      out.push(
        simulate({
          desiredRetention: RETENTIONS[i++],
          newCardsPerDay: newPerDay,
          days: DAYS,
          maximumInterval: preset.maximumInterval,
          weights,
        })
      );
      setResults([...out]);
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
    return () => {
      cancelled = true;
    };
  }, [newPerDay, preset.maximumInterval, preset.weights]);

  const max = Math.max(1, ...results.map((r) => r.avgReviewsPerDay));

  return (
    <div className="presets__sim">
      <span className="presets__label">
        <LabelWithTip
          tip={
            <>
              A rough forecast of the daily work for each retention level, after
              six months of {newPerDay} new cards a day. It assumes you answer
              Good when you remember. Higher retention costs more reviews, and
              the cost grows fast above 95%.
            </>
          }
        >
          Workload simulator
        </LabelWithTip>
      </span>
      {newPerDay <= 0 ? (
        <Text size="sm" variant="dimmed">
          Set new cards per day above 0 to simulate the workload.
        </Text>
      ) : (
        <table className="presets__sim-table">
          <thead>
            <tr>
              <th>Retention</th>
              <th>Reviews per day</th>
              <th>Cards still known</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.desiredRetention}
                className={
                  Math.abs(r.desiredRetention - preset.desiredRetention) < 0.005
                    ? "presets__sim-current"
                    : ""
                }
              >
                <td>{Math.round(r.desiredRetention * 100)}%</td>
                <td>
                  <span
                    className="presets__sim-bar"
                    style={{ width: `${(r.avgReviewsPerDay / max) * 100}%` }}
                  />
                  <span className="presets__sim-num">
                    {Math.round(r.avgReviewsPerDay)}
                  </span>
                </td>
                <td>{Math.round(r.cardsKnown).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
