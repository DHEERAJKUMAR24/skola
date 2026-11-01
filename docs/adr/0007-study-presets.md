# 0007. Anki-style study presets with legacy inline fallback

Date: 2026-11-01
Status: Accepted

## Context
Per-deck copies of FSRS settings are hard to manage; users expect Anki option groups and RemNote-like control.

## Decision
Introduce presets (`presets` table, synced). A deck references one by `options.presetId`; exam date stays on the deck. `effectiveOptions` resolves preset, then legacy inline options, then global settings. Sub-decks start with the parent's preset.

## Consequences
Settings are shared across decks using a preset. Old decks keep working untouched and can be moved to a preset in the deck form.
