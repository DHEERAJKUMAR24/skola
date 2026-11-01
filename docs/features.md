# Features by module

- **Home:** deck tree, per-deck counts (review / new / learning), create deck (name, description, color, preset, exam date).
- **Deck page:** hero study button, exam panel (cards on track), sub-decks, edit, move, rename, menu.
- **Deck color picker:** radio group, named swatches, check mark on selection.
- **Study session:** Again/Hard/Good/Easy (Hard/Easy can be hidden), daily limits, cram and learn-all modes, leech and sibling rules.
- **Card controls:** card scheduling modal (due date, suspend, bury, reset), card menu in the editor.
- **Notes explorer:** search, filter, tags, bulk bar (move, tag, suspend), note tags editor.
- **Settings tabs:** General, Appearance, Editing, Learning (global scheduler fallback), Study presets, Database, Account (sync, push delay), About, Developer.
- **Profile menu / avatar:** sync status with push countdown ring, Sync now, Account settings, Take a tour of this page, sign in/out.
- **Tooltips:** `InfoTip` (hover, focus, tap, Escape) rendered with the Popover API so it sits above modal dialogs; `LabelWithTip` for form labels. Used on the preset and deck forms.
- **Tours:** `src/components/Tour/` (driver.js). `tours.ts` lists tours per route (home, deck, learn, notes, presets). `TourHost` auto-starts each once, drops steps whose element is missing, stores seen ids in the synced setting `#toursSeen`. Replay via profile menu (`startTourHere`). Closing a tour also marks it seen.
- **Statistics:** local only.
