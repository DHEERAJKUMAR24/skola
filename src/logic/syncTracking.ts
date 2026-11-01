import type { Database } from "./db";

/** Set while pulled server rows are written, so they are not re-marked as local edits. */
export const syncFlags = { applyingRemote: false };

/** Tells the sync loop something changed locally, so it can push soon instead of polling. */
export const LOCAL_CHANGE_EVENT = "local-change";
const notify = () => {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
};

export interface Tombstone {
  id: string;
  table: string;
  updatedAt: number;
}

// The old `statistics` table has a composite key and is read-only legacy data, so it stays local.
const SYNCED_TABLES = [
  "decks",
  "cards",
  "notes",
  "settings",
  "presets",
  "studySessions",
] as const;

/** Stamps updatedAt on every local write and records deletions as tombstones. */
export function installSyncTracking(db: Database) {
  for (const name of SYNCED_TABLES) {
    const table = db.table(name);
    table.hook("creating", (_pk, obj) => {
      if (syncFlags.applyingRemote) return;
      obj.updatedAt = Date.now();
      notify();
    });
    table.hook("updating", () => {
      if (syncFlags.applyingRemote) return undefined;
      notify();
      return { updatedAt: Date.now() };
    });
    table.hook("deleting", function (pk) {
      if (syncFlags.applyingRemote) return;
      notify();
      // shortcut: tombstone written after the delete commits; a tab closed in that instant loses it.
      this.onsuccess = () => {
        setTimeout(() =>
          db.tombstones.put({
            id: String(pk),
            table: name,
            updatedAt: Date.now(),
          })
        );
      };
    });
  }
}
