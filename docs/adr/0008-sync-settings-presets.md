# 0008. Sync settings and presets; keep statistics and review logs local

Date: 2026-11-01
Status: Accepted

## Context
Owner wants settings identical on every device.

## Decision
Add `settings` (key path `key`) and `presets` to the synced tables, backfill `updatedAt` on settings in Dexie v26. Statistics stay local.

## Consequences
Small payloads, settings roam. Statistics and the optimizer's inputs are per device until review-log sync is added.
