# FSRS and study presets

## Scheduling core
- ts-fsrs computes stability, difficulty and state. Our code never rewrites stability or difficulty.
- `src/logic/scheduling/policy.ts` `scheduleCard` is an overlay that only adjusts `due` and `scheduled_days`:
  1. whole-day alignment (day starts at `newDayStartHour`, default 4)
  2. easy days (`avoidEasyDays`, only for intervals >= `EASY_DAYS_MIN_INTERVAL`)
  3. exam cap (`examDate`, `examBufferDays`, optional `examRamp` raises retention in the last 45 days)
  4. max-interval cap (ts-fsrs does not enforce it by itself)
- Other policy helpers: `isLeechLapse`, `siblingsToBury`, `applyRandomOrder`, `resolveExam` (sub-decks inherit the nearest ancestor exam date).
- Scheduling modes: `exact` (minute steps) or `daily` (whole days, no short-term steps).

## Presets (Anki option groups)
- `src/logic/deck/presets.ts`: `StudyPreset`, `PRESET_DEFAULTS`, `DEFAULT_PRESET_ID = "default"`, `effectiveOptions(deck, presets)`, `ensureDefaultPreset`, `createPreset`, `savePreset`, `deletePreset` (decks fall back to Default), `assignPreset`, `usePresets` (sorted copy; live-query arrays are read-only).
- Preset fields: name, new cards/day, max reviews/day, new card order, scheduling mode, learning and relearning steps, desired retention (70-99%), max interval, fuzz, personal weights (21 numbers), easy days, bury new/review siblings, leech threshold + action.
- A deck points to a preset with `deck.options.presetId`. Exam fields stay on the deck (`examDate`, `examBufferDays`, `examRamp`).
- Legacy decks without `presetId` keep inline options; `effectiveOptions` falls back to them, then to global settings (`LearnSettingsView`, only affects decks with no preset).
- Sub-decks start with the parent's preset when created.
- Presets sync. Edit UI: Settings > Study presets (`src/app/settings/presets/`). Deck form: `DeckStudyFields.tsx` (picker + exam).

## Learning session (`src/logic/learn.ts`)
Uses today's activity (`useTodayActivity`: new cards seen, reviews per deck) to enforce daily new and review caps (skipped for learn-all and cram), `newToReviewRatio`, random order, leech action and sibling burying after each answer.

## Optimizer and simulator
- `src/logic/fsrs/optimizer.ts` + `optimizer.worker.ts`: fsrs-browser WASM in a worker; trains on review logs using study-day numbers (not floor of elapsed days); gated by `MIN_OPTIMIZE_REVIEWS = 400`; result saved as preset weights.
- `src/logic/fsrs/simulate.ts` + `WorkloadSimulator.tsx`: projects reviews per day and cards known for a retention value.
- Not yet verified in a real browser on real history. Plan: insert synthetic review logs with fake card ids through raw IndexedDB, run, delete them.

## Seed
`src/logic/seed/jsInterview.ts` builds Programming Languages > JavaScript > 7 concepts x 6 cards with tags, presets Default / Exam prep (95%) / Whole days, and an exam date on JavaScript. Optional simulated review history.
