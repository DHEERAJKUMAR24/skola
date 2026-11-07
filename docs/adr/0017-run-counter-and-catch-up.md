# 0017. A run counter on each card, and catch-up as a read-time override (proposed)

Date: 2026-11-07
Status: Proposed (waiting for the owner's approval; see `docs/spec-targeted-review.md`)

## Context
The owner wants Skola to move learners from isolated facts to understanding and to keep the card count down: cards answered right three times in a row should be upgraded into harder, connected questions; cards wrong three times in a row need deeper work, not more repetition; and a learner who falls behind needs a way out that does not rewrite presets. Review logs sync, but computing "3 in a row" from them means scanning each card's history on every open and differs on a device that has not pulled.

## Decision
- Each card carries an optional `run` counter (positive: correct in a row, negative: wrong in a row), written inside the same Dexie transaction as the review (`updateCardModel`) and by the same pure rule on the MCP path. Only Review-state answers count; learning, relearning and cram never do. A saved content edit resets it, except on master notes; a card reset to New clears it.
- Catch-up is a synced setting that overrides limits when they are read (new cards 0, 100 reviews a day in total), never edits presets, and is switched off only by the user.
- Fusing cards creates a new card linked to its sources; the sources stay in study.
- The card budget is measured as new cards created per week, not as reviews.

## Consequences
- One optional card field; no Dexie version, no migration, no server table.
- `updateCardModel` gains a read of the card's current state and run inside its transaction, and `useLearning` gains a cross-deck total cap.
- The MCP study tools must apply the same catch-up clamp, because they do not read presets today.
- `run` is last-write-wins across devices; a lost update only delays a card appearing in a list.
- Seeded skill text does not reach an existing database (`0006-skills-in-postgres-served-over-mcp.md`), so skill changes need a manual delivery step.
