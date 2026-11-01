# Gotchas

- **Dexie live-query results are read-only in dev.** Copy before sorting: `[...rows].sort(...)`. Hit in `usePresets` when a second preset existed.
- **`z-index` cannot beat a modal `<dialog>`** (top layer). Use the Popover API (`popover="manual"` + `showPopover()`) for floating UI over modals.
- **ts-fsrs does not enforce `maximum_interval`** in all paths; the policy overlay caps it.
- **Training deltas** must use study-day numbers, not `floor(elapsed days)`.
- **Race on first run:** `ensureDefaultPreset` can be called twice; the duplicate add error is swallowed on purpose.
- **Settings sync** needs `updatedAt` on settings rows (Dexie v26 backfill) and key path `key`.
- **Order of side effects:** roll back before throwing in OTP and refresh-token flows; reject login cookies for users that no longer exist.
- **Tour seen flag** is written on destroy, including closing with X and re-running a tour.
- **Next dev + HMR** can leave the page unstyled after large edits; navigate to a fresh URL.
- **`role="status"`** triggers Biome; use `<output>`.
- **Removed exports:** `FSRS_DEFAULTS` stays only in `fsrsOptions.ts` for tests; `toFormState`/`fromFormState`/`DeckFsrsFields` are gone, use `examForm.ts` and `DeckStudyFields`.
