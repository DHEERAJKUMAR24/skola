# 0008. Sync settings and presets; keep statistics and review logs local

Date: 2026-11-01
Status: Accepted

## Context
Owner wants settings identical on every device.

## Decision
Add `settings` (key path `key`) and `presets` to the synced tables, backfill `updatedAt` on settings in Dexie v26. Statistics stay local.

## Consequences
Small payloads, settings roam. Statistics and the optimizer's inputs are per device until review-log sync is added.

## Update 2026-11-07
The title is out of date. Review logs now sync: `src/logic/sync.ts` pushes `reviewLogs` by `reviewedAt` (append-only, so they are not part of the `updatedAt` tracking in `syncTracking.ts`), and MCP grading writes them as well. `studySessions` (per-day totals) sync too. Only the legacy `statistics` table stays local.
