import { useLiveQuery } from "dexie-react-hooks";
import { Rating, State } from "ts-fsrs";
import { db } from "../../db";
import { logicalDayStart } from "../../scheduling/policy";

export interface TodayActivity {
  /** Cards whose first-ever review happened during the current study day. */
  newSeen: Set<string>;
  /** Review answers given today, per card (not counting the first review or manual changes). */
  reviewed: Map<string, number>;
}

/** What has already been studied during the current study day, so daily limits can be applied. */
export function useTodayActivity(newDayStartHour: number) {
  return useLiveQuery(async (): Promise<TodayActivity> => {
    const start = logicalDayStart(new Date(), newDayStartHour).getTime();
    const logs = await db.reviewLogs
      .where("reviewedAt")
      .aboveOrEqual(start)
      .toArray();
    const newSeen = new Set<string>();
    const reviewed = new Map<string, number>();
    for (const l of logs) {
      if (l.rating === Rating.Manual) continue;
      if (l.state === State.New) newSeen.add(l.card);
      else if (l.state === State.Review)
        reviewed.set(l.card, (reviewed.get(l.card) ?? 0) + 1);
    }
    return { newSeen, reviewed };
  }, [newDayStartHour]);
}
