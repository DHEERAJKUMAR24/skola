import Dexie, { Table } from "dexie";
import "dexie-export-import";
import { Card } from "./card/card";
import { ReviewLogRecord, toReviewLogRecord } from "./card/reviewLog";
import { Deck } from "./deck/deck";
import type { StudyPreset } from "./deck/presets";
import type { MediaRow } from "./media/media";
import { NoteType } from "./note/note";
import { Note } from "./note/note";
import { Settings, SettingsValues } from "./settings/Settings";
import type { DeckStatistics, StudySession } from "./statistics";
import { Tombstone, installSyncTracking } from "./syncTracking";

export class Database extends Dexie {
  decks!: Table<Deck>;
  cards!: Table<Card<NoteType>>;
  notes!: Table<Note<NoteType>>;
  /** Legacy per-day totals; replaced by studySessions, kept so no data is lost. */
  statistics!: Table<DeckStatistics>;
  studySessions!: Table<StudySession>;
  /** Picture bytes kept on this device; local only. The note holds a `media:` reference. */
  media!: Table<MediaRow>;
  settings!: Table<Settings<keyof SettingsValues>>;
  reviewLogs!: Table<ReviewLogRecord>;
  tombstones!: Table<Tombstone>;
  presets!: Table<StudyPreset>;

  constructor() {
    super("skola_db", { cache: "immutable" });
    this.version(22).stores({
      cards: "id, note, deck",
      decks: "id, *cards, *notes, *subDecks, *superDecks",
      notes: "id, deck, sortField, *linkedNotes",
      statistics: "[deck+day], day",
      settings: "key",
    });
    this.version(23)
      .stores({ reviewLogs: "id, card, reviewedAt" })
      .upgrade(async (tx) => {
        // Move per-card history into the append-only reviewLogs table.
        // Ids are deterministic so re-running the upgrade cannot duplicate rows.
        const logs: ReviewLogRecord[] = [];
        await tx
          .table("cards")
          .toCollection()
          .modify((card: { id: string; history?: ReviewLogRecord[] }) => {
            (card.history ?? []).forEach((log, i) => {
              const review = new Date(log.review);
              logs.push(
                toReviewLogRecord(
                  card.id,
                  { ...log, review },
                  `${card.id}:${review.getTime()}:${i}`
                )
              );
            });
            // biome-ignore lint/performance/noDelete: removing a stored field
            delete card.history;
          });
        await tx.table("reviewLogs").bulkPut(logs);
      });
    this.version(24).stores({ tombstones: "id, updatedAt" });
    this.version(25).stores({
      notes: "id, deck, sortField, *linkedNotes, *tags",
    });
    this.version(26)
      .stores({ presets: "id" })
      .upgrade(async (tx) => {
        // Settings saved before they synced have no updatedAt; stamp them so they upload once.
        await tx
          .table("settings")
          .toCollection()
          .modify((s: { updatedAt?: number }) => {
            s.updatedAt ??= Date.now();
          });
      });
    this.version(27)
      .stores({ studySessions: "id, deck, day" })
      .upgrade(async (tx) => {
        // Each old per-day total becomes one session. The id is fixed so a re-run, or the same
        // legacy row on another device, never counts twice.
        const legacy = await tx.table("statistics").toArray();
        await tx.table("studySessions").bulkPut(
          legacy.map((s) => ({
            ...s,
            id: `legacy-${s.deck}-${s.day}`,
            updatedAt: Date.now(),
          }))
        );
      });
    // Local only: the bytes of pictures, uploaded to R2 in the background. Not synced.
    this.version(28).stores({ media: "id, uploaded" });
    installSyncTracking(this);
    this.open();
  }
}

export const db = new Database();
