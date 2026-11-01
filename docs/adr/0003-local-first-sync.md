# 0003. Dexie as source of truth, relay sync with updatedAt

Date: 2026-11-01
Status: Accepted

## Context
The app must work fully offline and stay inside free-tier API limits.

## Decision
All reads and writes hit Dexie. Hooks stamp `updatedAt` and write tombstones. The server stores rows in a per-user `changes` table with a `seq`; push applies a row only if strictly newer; pull is incremental. Pushes are debounced (user setting 5 s to 15 min) and idle tabs make no requests.

## Consequences
Last-writer-wins by device clock; clock skew can mis-order edits (upgrade to a hybrid logical clock if it matters). Review logs are append-only and never conflict.
