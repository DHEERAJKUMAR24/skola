import type { Database } from "./db";

/** Set while pulled server rows are written, so they are not re-marked as local edits. */
export const syncFlags = { applyingRemote: false };

export interface Tombstone {
  id: string;
  table: string;
  updatedAt: number;
}

// shortcut: decks/cards/notes only; settings and statistics have other keys, add with the Worker.
const SYNCED_TABLES = ["decks", "cards", "notes"] as const;

/** Stamps updatedAt on every local write and records deletions as tombstones. */
export function installSyncTracking(db: Database) {
  for (const name of SYNCED_TABLES) {
    const table = db.table(name);
    table.hook("creating", (_pk, obj) => {
      if (!syncFlags.applyingRemote) obj.updatedAt = Date.now();
    });
    table.hook("updating", () =>
      syncFlags.applyingRemote ? undefined : { updatedAt: Date.now() }
    );
    table.hook("deleting", function (pk) {
      if (syncFlags.applyingRemote) return;
      // shortcut: tombstone written after the delete commits; a tab closed in that instant loses it.
      this.onsuccess = () => {
        setTimeout(() =>
          db.tombstones.put({ id: String(pk), table: name, updatedAt: Date.now() })
        );
      };
    });
  }
}
