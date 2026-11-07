const HOUR_MS = 3_600_000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local wall time in `timeZone`, read as if it were UTC (ms). Throws RangeError for a bad zone. */
function wallMs(t: number, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const x of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(t))) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Study day as a UTC-midnight ms: local time shifted back by `hour`, like logicalDayStart. */
function studyDayMs(date: Date, hour: number, timeZone: string): number {
  const shifted = wallMs(date.getTime(), timeZone) - hour * HOUR_MS;
  return shifted - (((shifted % 86_400_000) + 86_400_000) % 86_400_000);
}

/** "YYYY-MM-DD" of the study day containing `date` in `timeZone`. */
export function logicalDateIn(
  date: Date,
  hour: number,
  timeZone: string
): string {
  return new Date(studyDayMs(date, hour, timeZone)).toISOString().slice(0, 10);
}

/** The instant the study day containing `date` began, in `timeZone`. */
export function logicalDayStartIn(
  date: Date,
  hour: number,
  timeZone: string
): Date {
  const target = studyDayMs(date, hour, timeZone) + hour * HOUR_MS;
  // Offset at the guess may differ across a DST change, so apply it twice.
  let t = target;
  for (let i = 0; i < 2; i++) t = target - (wallMs(t, timeZone) - t);
  return new Date(t);
}
