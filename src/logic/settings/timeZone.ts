import { db } from "../db";
import { setSetting } from "./setSetting";

/**
 * Records this device's time zone once. The server reads it to decide when the learner's day
 * starts. Never overwrites: two devices in different zones would fight, so only the picker changes it.
 */
export async function ensureTimeZone(): Promise<void> {
  if (await db.settings.get("#timeZone")) return;
  await setSetting(
    "#timeZone",
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}
