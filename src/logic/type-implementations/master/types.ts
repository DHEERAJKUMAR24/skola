// Types of the master note type. The pure rules live in src/logic/master/ (model, coverage,
// suggested rating) so the server can use them too.
export type { MasterNoteContent } from "@/logic/master/masterModel";

/**
 * A master card has one card for the whole master (no `sectionId`) or, above about 12 entries,
 * one card per top-level section (`sectionId`). `retired` marks a card the plan no longer wants
 * but that had been reviewed, so it was suspended instead of deleted (its history stays).
 */
export type MasterCardContent = {
  sectionId?: string;
  retired?: boolean;
};
