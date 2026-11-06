# 0011. Note edit history: previous version kept for 7 days, no cron

Date: 2026-11-03
Status: Accepted

## Context
Edits by the app or an assistant can overwrite good card text. Full history costs storage and has little value for spaced repetition. The owner set the rule: keep only the last 7 days, never leave an old card (last edited 30 days ago) with empty history, and run no scheduled job.

## Decision
`pushRows` calls `recordNoteVersion` (`src/server/noteHistory.ts`, table `note_versions`) for every note write. It saves the version being replaced, then deletes that note's versions older than 7 days except the one just saved. App saves within 5 minutes merge into one version; MCP edits never merge. Inline pictures are not stored (a marker is kept; restore keeps the current picture). The hook runs in a SAVEPOINT and never throws. MCP tools `card_history` and `restore_card_version` read and restore; a restore saves the current text first.

## Consequences
No cron, and pruning happens on write. A note not edited again keeps its last previous version indefinitely (by design). Syncing keeps working before the migration is applied. The app now has the screen (2026-11-06): History in the note and card menus (`NoteHistoryModal`), a word diff against the current text and Restore. History stays server-only, so the app reaches it through `/api/history`, which runs the same tool functions as MCP (`src/server/appApi.ts`); signed out or offline it says "History needs sign-in and a connection". The app first pushes unsent edits (an older local copy would otherwise overwrite the restore on its next push) and pulls afterwards. `card_history` also returns `current`, the text as stored now, for the comparison.
