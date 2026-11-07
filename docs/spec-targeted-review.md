# Targeted review and card fusion (design)

- **Status:** DESIGN, reviewed against the code on 2026-11-07, waiting for the owner's approval. Nothing is built.
- **Phase:** 22 in `docs/SPEC.md` (21 was the background-jobs phase, dropped). Proposed decision record: `docs/adr/0017-run-counter-and-catch-up.md`.
- **Depends on:** nothing built. Reports remaining-today numbers through `get_limits` once Phase 16.1 exists; until then `set_catch_up` returns its own state.
- **Sources the owner supplied:** Justin Sung (memorization filter, targeted review, merge and upgrade, a small weekly budget of hand-made cards), and an Anki-using doctor (principle cards, "a card you can get right without understanding is a bad card", the catch-up settings).

## 1. Intent

Flashcards are good at retention and bad at the rest of learning. Students who put everything on cards end up with thousands of them, fall behind, and learn the card's wording instead of the knowledge (they recognise the first three words and the answer pops out). Skola should push the other way:

- fewer cards, and only for what really needs rote memory;
- cards that grow into higher-order questions as the basics stick, so the wording never settles;
- a fix for cards that keep failing that is deeper understanding, not more repetition;
- a way out when the learner falls behind.

The thinking the learner does (deciding what matters, connecting) is the learning. The owner chose to let the AI draft the harder fused questions to save time; the learner judges, edits and approves every draft, and can always write their own.

## 2. Goals

1. **Two lists that fill as you review.** "Ready to upgrade": cards answered correctly 3 times in a row. "Stuck": cards answered wrong 3 times in a row.
2. **Targeted review page** that works through both lists.
3. **Stuck cards:** go deeper (why it matters, what it connects to, an analogy), rewrite, or delete.
4. **Fuse:** pick 2 or 3 ready cards, write (or have the AI draft) one question about how they relate, save it as a new card linked to its sources. **The originals stay in study, linked; nothing is retired or removed (owner decision).**
5. **Filter before a card exists:** an optional three-question check when making a card by hand, and the same check as the first step of the AI card-writing skill.
6. **Load guard:** a card budget (new cards added per week) and a one-switch catch-up mode when behind.

## 3. Non-goals

- Note-taking, mind maps, priming or encoding tools (the master card and K/S tutor cover the in-Skola parts).
- AI question variants per fact (section 10).
- Changing FSRS: nothing here rewrites stability or difficulty.
- A server table, a background job or anything on a timer.

## 4. Anti-goals

- Fused cards that go live without the learner reading and approving them.
- Fused cards so big that Again or Good means nothing (aim for 2 or 3 ideas).
- A deck that only grows.
- Anything that needs a connection to study.

## 5. Constraints

- Local-first: the app reads and writes Dexie; the server is a sync relay. Review logs sync (pushed by `reviewedAt`), so numbers computed from them are as fresh as each device's last pull.
- No cron, polling or background worker (SPEC N3).
- FSRS policy may only change `due` and `scheduled_days` (`adr/0006-fsrs-overlay-policy.md`).
- Every new setting gets an `InfoTip`; the new page gets a tour entry; logic gets Vitest tests (PGlite for server code); docs updated with the build (SPEC, HANDOFF, ADR 0017).

## 6. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| A. The learner writes the fused question; Skola lays the cards side by side | Keeps the full encoding benefit; slower | Kept as the in-app path (the app has no AI) |
| **B. The AI drafts the question over MCP; the learner edits and approves** | Fast; risk of reading instead of thinking, softened by approval | **Chosen by the owner** |
| C. Skola fuses automatically | No effort, no learning | Rejected |

Run tracking: computing "3 in a row" from review logs means scanning each card's history on every open and looks different on a device that has not pulled. A counter on the card is one field to read, syncs with the card and also counts MCP reviews. **(My call.)**

## 7. Design

### 7.1 The run counter

- New optional card field `run?: number` on `CardSkeleton` (`src/logic/card/card.ts`): positive = correct answers in a row, negative = wrong in a row, missing or 0 = none.
- **Written inside the same Dexie transaction as the review,** not in `afterAnswer`. `updateCardModel` already writes the card model and the review log in one transaction (`src/logic/card/updateCardModel.ts`). The run update joins it: it reads the card's current `run` and `model.state` from Dexie inside the transaction (not from the snapshot passed by `useLearning`, which can be stale), applies the pure rule, and writes `run` with the model. A crash between review and run cannot lose the update, and a card whose deck options did not load still counts (`afterAnswer` returns early without options).
- MCP: the same pure rule is applied where `grade_card` and `submit_review` write the card row (`src/server/mcpWrite.ts`, study session submit).
- **Rule** (pure function in `src/logic/scheduling/run.ts`, with tests): only a review of a card whose state before the answer was Review counts; Again sets the run to -1 (or one lower if already negative); Hard, Good or Easy raises a non-negative run by one (a negative run restarts at +1). Learning and relearning steps never count, so one sitting cannot build a fake run. Cram reviews never count.
- Thresholds: preset fields `upgradeAfter` and `stuckAfter` (default 3; 0 turns that list off), inherited like other preset fields. They must be added to the `DeckOptions` type (`src/logic/deck/deck.ts`), the preset type and `PRESET_DEFAULTS` (`presets.ts`), `presetForm.ts` and the `PresetEditor.tsx` form, the fixed field list in `effectiveOptions.ts` (a field missing there is silently ignored), the field map of `update_preset` and the outputs of `list_presets` and the effective-options output in `src/server/mcpManage.ts`, with InfoTips. Presets already stored have no such fields, so every read uses `?? 3`.
- Multi-device: cards sync as whole rows, last write wins, so a suspend or edit on another device can overwrite a run. Accepted: the worst case is a card appearing in a list a little late or early.
- Yield: with FSRS intervals, three Review-state answers can take weeks, so the Ready list may fill slowly. The build checks this on the owner's real data before building the page (build step 1 shows the counts on the deck page first).

### 7.2 The two lists

- "Ready to upgrade": not suspended, `run >= upgradeAfter`. A card that already has a fused card shows a "fused" mark.
- "Stuck": not suspended, `run <= -stuckAfter`. Separate from the existing leech rule (total lapses); both can apply.
- Computed by a scan of `db.cards` when the page or deck page opens (the Dexie `cards` index is `id, note, deck, updatedAt`; there is no index on `run`). The "has a fused card" lookup scans notes' `fusedFrom`. At about 5,000 cards or notes, add an index in a new Dexie version; below that a scan is fine.
- Deck page shows the two counts next to the due count.

### 7.3 Targeted review page (`/#/targeted-review`, optional deck filter)

```
Targeted review · Pharmacology          Stuck 6 · Ready 14
[ Stuck ]  [ Ready to upgrade ]  [ Drafts to approve 2 ]

Stuck
  Sulfonamides: adverse effects            wrong 3 in a row
     Why does it matter? ____  Connects to? ____  Analogy? ____
     [Save and keep]  [Rewrite card]  [Not worth knowing: delete]
```

```
Ready to upgrade   (pick 2 or 3)
  [x] How is protein synthesised?
  [x] How do cells receive hormones?
  [ ] Mechanism of penicillin
  Your question: How do hormones influence protein synthesis? ____
  Answer: ____
  [Save fused card]     [Ask AI to draft questions]
```

- **Go deeper:** three optional boxes saved on the note as `deeper: { why, connects, analogy }`. Every card of that note shows it on the answer side as a collapsed "Deeper" section (one shared component, not a change per renderer). Saving `deeper` resets the run of that note's cards.
- **Rewrite** opens the editor; **Delete** uses the normal delete.
- **Content edits reset the run** (a changed card is a new test). The reset is a single rule applied at these write paths, and each is listed with a test:
  - the app: `updateNoteContent` (`src/logic/note/`) runs one transaction over the note and `db.cards.where("note")` and resets `run` on all of the note's cards (cloze siblings included); the unused second path in `updateNote.ts` is deleted;
  - MCP: `edit_card` in `src/server/mcpWrite.ts` (not `mcpNotes.ts`, whose `editNote` only returns content) builds **one row per card id**, applying the run reset and any `suspended` change to the same row (two rows for one id make `putRows` throw "A concurrent write won");
  - `restore_card_version` (MCP, and the app's History modal through `appApi.ts`) writes content, so it resets too.
  **Exemptions:** a tag-only or suspend-only change; the picture migration (`media.ts` writes with `db.notes.update` directly, so it never reaches the reset); the cloze and image-occlusion flows that call `updateNoteContent` when a card is deleted (`ClozeNote.tsx`, `ImageOcclusionNote.tsx`), which pass `resetRun: false` so the surviving siblings keep their runs; and **master notes** (`MasterNote.tsx` calls `updateNoteContent` on every master edit, which would reset every card of the master): `updateNoteContent` skips `type: master`.
  `updateNoteContent` writes only the cards whose `run` is non-zero (an autosave burst must not rewrite every sibling card and flood sync). **Row merging:** `putRows` throws when two rows target one card id (`mcpData.ts`), so every MCP path merges its rows by card id before writing: `edit_card` (run reset, `suspended`, new cloze cards) and `restore_card_version` (content plus the master re-plan rows from `replanRows`). `submit_review` calls `gradeCard` (`mcpStudy.ts`), so the run is updated **once, in `gradeCard`** only.
  **A card reset to New** (`resetCard` in `cardControls.ts`, the `set_card_schedule` reset in `mcpManage.ts`) also clears `run`, so a reset card does not stay in the Stuck list.
- **Master notes:** `edit_card` refuses content edits of a master (use `update_master_card`), so "deeper" for a master's own cards (including relation cards of Phase 23) is done in the builder in the app, not over MCP. Accepted.
- Ready cards are grouped by deck, then first tag. Relation cards and a master's own cards may appear in Stuck but are never offered in Ready as fusion sources (they are not eligible, 7.4). In the app, hints only say which cards share a tag, deck or note link.

### 7.4 Fusing

> **Owner decision (2026-11-07): the original cards stay in study, linked to the fused card; they are never retired or removed.** Answering a fused card does not touch its sources.

- **Data:** a normal basic note with two new optional fields on `NoteSkeleton`: `fusedFrom?: string[]` (source **card** ids) and `fusionDraft?: boolean`; and a one-way `linkedNotes` entry on the **fused note only** pointing at the sources' notes (`linkNotes` writes both notes, which would touch the sources, so it is not used). A draft gets its deck at draft time: the deck most sources are in, with `note.deck` and `deck.notes` set then; approval creates the card in `note.deck`.
- **Eligible sources:** 2 or 3 cards, each existing, not suspended, not a master's own card (section or relation card), not in another pending draft (a draft note lists its source ids in `fusedFrom`). They may come from different decks; the fused card goes in a deck the learner picks (default: the deck most sources are in).
- **Start:** the fused card is a normal New card with normal learning steps and it **counts against the new-card limit like any card** (no special flag; catch-up holds new cards back like others). *Changed from an earlier draft:* an exemption would need a card flag and changes to `limitNewCards` and the today-activity count for little gain.
- **Sources stay in study.** Nothing is suspended or hidden. A source keeps its own schedule and run. The ready list marks sources that already have a fused card; the notes explorer shows "fused into". The learner may suspend sources with the existing bulk bar. Consequence: fusing does not shrink the card count by itself; the card budget, the stuck list and deleting cards "not worth knowing" do that.
- **Deleted sources:** nothing is cleaned up. `fusedFrom` ids that no longer exist are ignored and shown as "deleted source".
- **Undo:** deleting the fused card undoes a fusion (sources were never touched). A run reset is not undoable (accepted).
- A fused card can itself become ready and be fused again.

### 7.5 Filter before a card exists

- Hand-made cards: a collapsible "Should this be a card?" panel on the new-note page with the three questions (Why does it matter? What does it connect to? Do I need to apply it or just recall it?). Switch in Settings (`#cardFilter`, default on).
- Principle cards: a hint in the editor with the example "Using the meaning of *ortho*, explain orthodontics".
- AI: `skola-card-architect` gets the filter as its first gate and prefers principle and relationship cards (text gate, ADR 0015).

### 7.6 Card budget and catch-up

> **Precedence:** limits are read in this order: the preset, then a daily boost (`#dailyBoosts`, Phase 16.1), then catch-up, which overrides both while on.

- **Card budget** (replaces the earlier "weekly review count", which a normal 200-reviews-a-day preset would always exceed): setting `#cardBudget`, default 35, counts **new cards created in the last 7 logical days** (`creationDate` of cards, rolling, day start from `#newDayStartHour`). Over budget means the count of cards created in days 0 to 6 exceeds the budget; over budget two weeks running means days 7 to 13 also exceeded it. That shows "You may be putting too much on cards" with a link to the targeted review page. Computed locally when the home page opens; no review logs needed.
- **Catch-up:** one switch, synced setting `#catchUp: { on: boolean }`, a **read-time override** (presets are never changed, nothing to restore):
  - While on: effective new cards per day 0, and **a total of 100 reviews a day across all decks.** A *review* here is a Review-state answer (what `useTodayActivity` counts); learning and relearning answers are uncapped, exactly as in the app today (`learn.ts` skips all caps for them and trims only the due Review cards). The app's limits are per deck (`limitNewCards`, `policy.ts`), so the total is a new cross-deck cap in `useLearning`: sum `today.reviewed` over all decks (not `reviewedByDeck`, which covers only the cards in scope), subtract from 100 and trim the due list.
  - MCP: **clamp the effective limits** while catch-up is on: new cards 0, and the reviews served to what is left of 100 today, counted by the Phase 16.1 rule from the synced review logs. This applies to `start_study_session`, `get_due_cards` **and `grade_card`** (which is otherwise unbounded). `get_limits` (Phase 16.1) reports the state.
  - **Counting:** this is a different query from the Phase 16.1 "new cards seen" rule: it counts Review-state answers (state before the answer = Review), not distinct cards, excluding manual rows, as `useTodayActivity` does. It is bypassed in sessions that use `learnAll` or cram (the weak drill, scoped master sessions, practice), which the learner chose on purpose; the daily sessions are capped.
  - **It never switches itself off.** When the overdue count across decks is under 100 the study screen shows "You have caught up: turn catch-up off" with a button; MCP reports `catch_up_done: true`. A user action writes the setting, so reading never writes and two devices cannot race to write it. Offline toggles on two devices resolve last write wins (accepted).
- The AI cannot raise the 100: `set_catch_up` only switches it on or off.

### 7.7 MCP

- `list_targeted_review` (deck optional): the two lists with run counts and `fused_into` where there is one.
- `draft_fusions` (groups of 2 or 3 source card ids, each with question and answer): saves each as a **note-only record** (`fusionDraft: true`, **no card yet**) without touching the sources. Drafts sync and appear under "Drafts to approve" (and in the notes explorer marked as drafts), where the learner edits and approves or rejects. A note with no card is never studied, and because the card does not exist, no unsuspend path (`edit_card`, `bulk_update_cards`, the scheduling modal) can release a draft by accident.
  - **Approve** (one transaction): first re-check that every source still exists and is not suspended (show an error if not), then create the note's card and clear `fusionDraft`.
  - **Reject:** delete the draft.
  - A source already in a pending draft is refused when drafting (best effort; there is no server constraint, so two assistants at once can still collide, and approval re-checks).
- `fuse_cards` (2 or 3 source card ids, question, answer): creates the note and its card at once, for when the learner approved the wording in the chat. The skill says show the draft and wait for a yes; the server cannot prove it.
- Error codes, in the existing `[code] message` form with the additive `structuredContent.code` of Phase 16: `fusion_bad_count`, `fusion_source_missing`, `fusion_source_ineligible`, `fusion_source_in_draft`.
- `get_card_details` and the study tools report `run`.
- `edit_card` reads and writes `deeper` for ordinary notes (not masters, see 7.3).
- `set_catch_up` (on or off) returns the state; `get_limits` includes it once built.
- Ask AI (`docs/spec-ask-ai.md`) builds prompts for `fusion.draft` and `card.rewrite_stuck`.

### 7.8 Fit with the app and with Phase 23

- Reviews reach `updateCardModel` from every route that uses `useLearning`: normal study, the `weak.<noteId>` param of `/learn/:deckId/:params`, and the Phase 23 `master.<noteId>` param. Cram reviews never count.
- `run` is optional card data; older devices ignore it; no Dexie version unless an index is added later (7.2).
- Settings are keys in the synced `settings` table (key path `key`), so they need no schema or server whitelist change; each new key (`#cardFilter`, `#cardBudget`, `#catchUp`) is added to `SettingsValues` and `defaultSettings` in `src/logic/settings/` and gets an InfoTip.
- Skill text changes are seeded only into an empty database (`adr/0006-skills-in-postgres-served-over-mcp.md`): the owner's live default skill must be updated by hand at `/skills/edit` or with `update_skill_file` (scope `default`). Acceptance for each skill change: `get_skill` returns the new step.
- **How this fits with masters:** fusing is the quick, ad-hoc way to turn two or three mastered cards into one harder question. A master (Phase 23) is the standing, visual home of a concept, and its opt-in relation cards cover how the parts connect. Relation cards are ordinary cards for the run counter and may show in Stuck; they are never fusion sources.

### 7.9 Human, AI and Ask AI for each part (parity)

| Part | Human UI | MCP | Ask AI |
|---|---|---|---|
| Run counter and lists | deck page counts, targeted review page | `list_targeted_review`, `run` in `get_card_details` | none needed |
| Stuck card | three boxes, editor, delete | `edit_card` (`deeper`, content), delete tools | `card.rewrite_stuck` |
| Fused question | write on the page | `draft_fusions`, `fuse_cards` | `fusion.draft` |
| Approve a draft | "Drafts to approve" | not allowed (a person approves) | none |
| Filter before a card | panel, hint, example | `skola-card-architect` gate | `cards.from_source` |
| Card budget and catch-up | settings, home page, switch | `get_limits`, `set_catch_up` | none needed |

Rule: no feature is done until the human UI and the MCP columns both exist, and every AI-needing row has its Ask AI action.

## 8. What changes where

| Area | Change |
|---|---|
| `src/logic/card/card.ts` | `run?: number` |
| `src/logic/scheduling/run.ts` (new) | pure run rule, tests |
| `src/logic/card/updateCardModel.ts` | run update inside the existing transaction |
| `src/server/mcpWrite.ts`, `mcpStudy.ts` | run update on grade and submit; catch-up clamps |
| `src/logic/note/updateNoteContent.ts` (skips master notes, `resetRun` option), `src/server/mcpWrite.ts` (`edit_card`, `gradeCard`), `src/server/mcpManage.ts` (`restore_card_version`, the `set_card_schedule` reset), `src/logic/card/cardControls.ts` (`resetCard`) | reset, update or clear `run` as listed in 7.3 and 7.1 |
| `src/logic/note/note.ts` | `fusedFrom?`, `fusionDraft?`, `deeper?` on the note types |
| presets, `presetForm.ts`, `effectiveOptions.ts`, `mcpManage.ts update_preset` | `upgradeAfter`, `stuckAfter` + InfoTips |
| `src/logic/learn.ts`, `useTodayActivity`, `CardScheduler.ts` | cross-deck total cap for catch-up |
| settings (`SettingsValues`, `defaultSettings`) | `#cardFilter`, `#cardBudget`, `#catchUp` |
| new page `/#/targeted-review`, deck page, home page, tour entry | lists, deeper, fuse, drafts, budget warning |
| `src/server/mcp*.ts` | `list_targeted_review`, `draft_fusions`, `fuse_cards`, `set_catch_up`, error codes |
| `src/server/skillSeedLearning.ts` (`skola-card-architect`: the filter gate) and `src/server/skillSeed.ts` (`skola`: the targeted-review and fusion steps) | then update the live skills |
| docs | SPEC row, HANDOFF, ADR 0017, `docs/features.md` |

No server migration and no new table.

## 9. Build order and done criteria

1. **Run counter and lists.** Done when: three Review-state Good answers give `run` 3; Again gives -1; Hard counts as correct; a learning or relearning answer and a cram answer do not count; a content save resets it; an MCP review updates it; the deck page shows both counts; tests cover the pure rule and the transaction.
2. **Stuck cards.** Done when `deeper` saves, shows on every card type's answer side, resets the run, and `edit_card` reads it.
3. **Fusion.** Done when 2 or 3 eligible cards fuse in the app and over MCP, drafts approve with revalidation, sources are untouched, errors return the listed codes, and a deleted source shows as "deleted source".
4. **Filter before a card.** Done when the panel shows, can be switched off, and the skill gate is delivered (`get_skill` shows it).
5. **Card budget and catch-up.** Done when the budget warning follows the 7-day rule, catch-up caps reviews at 100 in total in the app and over MCP, never switches itself off, and the precedence rule holds.
After each: `pnpm exec biome check --write`, `pnpm lint:type`, `pnpm test`; browser check for UI steps.

## 10. Later ideas (not in this phase)

- AI question variants per fact.
- "Why did you miss it?" chips on Again.
- Absurdify and story memory aids for last-resort facts.
- Linking a fused card to a K/S objective as evidence.

## 11. Calls I made (check these)

1. (Owner) AI drafts fused questions; the learner approves each; the in-app path stays learner-written.
2. The run is a counter on the card, written in the review's transaction.
3. Only Review-state answers count; Hard counts as correct; thresholds 3 and -3.
4. (Owner) Fusing keeps the originals in study, linked.
5. A fused card is an ordinary new card: it counts against the new-card limit.
6. Any saved content edit resets the run; a tag or suspend change does not.
7. Card budget is new cards added in 7 days, default 35 (replaces the weekly review count).
8. Catch-up: no new cards, 100 reviews a day in total, read-time override, switched off by the user, never automatically.
9. Fusing does not shrink the card count by itself.
10. Accepted limits: last write wins for `run` across devices; a run reset is not undoable; draft races are re-checked at approval only.
11. Ask AI is its own phase (24).
