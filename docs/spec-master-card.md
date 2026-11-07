# Master card, phase 23: the concept sheet, a session over its cards, relations, what-if

- **Status:** DESIGN, reviewed against the code on 2026-11-07 (second version, after an independent code review found the first one wrong in several places). Waiting for the owner's approval. Nothing is built.
- **Phase:** 23 in `docs/SPEC.md`. Builds on ADR 0014 (master card) and ADR 0012 (K/S mastery); uses Phase 22 (`spec-targeted-review.md`, for the run counter) and Phase 24 (`spec-ask-ai.md`). Proposed decision record: `docs/adr/0016-master-card-lens-over-cards.md`.
- **Research and plan:** `docs/research-master-card-visual-revision.md`, `docs/plan-master-card-redesign.md`.
- **Replaces:** the first draft ("Open and Revise with self-marked hidden entries"), which the owner tried as a prototype and rightly called a memory game.

## 1. Intent

A master card is the **one screen for a concept**: a compact, visual cheat-sheet you can open in a glance (before a seminar, while teaching), and the hub that ties together every card about that concept, whatever its type. Three jobs:

1. **See.** The whole concept at once: diagram, key points, examples, common mistakes, tips, related concepts, and how well each part is remembered.
2. **Test.** Active learning that is not a memory game: answer the real cards in their own type through the normal study screen (spaced repetition stays honest), explain relations between parts, predict what breaks when a step fails.
3. **Fix.** The sheet shows what is missing or weak and offers a one-tap fix or a prompt for the learner's own assistant.

The reference for "see" is a concept page like jsinterview.dev (timeline, key points, annotated code, common mistakes, tips, related concepts, next step). That page has no retrieval or spaced repetition; Skola adds them and builds the page **from the learner's own cards** so nothing is written twice.

## 2. What the review of the first prototype found

| Problem | Consequence |
|---|---|
| Self-marked "got it / missed" on box labels: shallow, a second quiz engine | Dropped. Testing is the existing study screen on real cards |
| One entry, one card | An entry links to many cards of any type |
| Nothing tested relations or understanding | Arrows can become scheduled relation cards; what-if is computed from the arrows |
| The sheet was only labels and arrows | Content blocks derived from cards plus one short authored tips block |
| No link between concepts | Related masters and a concept group |

## 3. Goals

- **Sheet (read mode):** diagram, key points, examples, common mistakes, tips, related concepts, next step. Writes nothing; prints; Present view.
- **Active mode per block:** "study these cards now" through `/learn`. Nothing renders its own quiz.
- **Many cards per entry,** any note type; one card may be linked from several masters.
- **Session over a master** through `/learn` with the normal rating buttons; practice through the existing cram mode.
- **Relation cards:** opt-in per arrow; cards of the master note, scheduled by FSRS.
- **What-if:** break a step, predict the downstream boxes; scored from the arrows.
- **Gaps** with a fix each; **readiness** (Recall, Explain, Predict, Apply); **concept group** and **related masters**; MCP and Ask AI paths for all of it.

## 4. Non-goals

- A content site or lesson authoring tool (only the tips block is free text).
- Self-marked quizzes; any AI inside the app; any cron or background job.
- Changing FSRS or the study screen's rating rules.
- Replacing the recall sweep, gap hunt, weak-spot drill or coverage engine (reused).

## 5. Anti-goals

- One tap that rates many cards. Every rating is one real card answered.
- A second review engine. Read mode that changes a schedule.
- A diagram that needs the network, or markup from an AI or import reaching the page.
- A master so heavy to author nobody builds one: AI drafts, the learner approves.

## 6. Constraints

- Local-first. **App side: no Dexie version** (note and card content are free JSON; settings are keyed rows). **Server side: one migration**, adding `master_id text` to `mcp_study_sessions` (MCP sessions persist only `deck_id` today; see 8.12). Nothing else on the server.
- No cron, polling or background work.
- FSRS: only the existing review path rates a card (`updateCardModel` through `useLearning`).
- Pure modules (no Dexie, no React) in `src/logic/master/`, as ADR 0014 did, so the MCP server reuses them.
- Every new setting and mode gets an `InfoTip`; the new views get tour entries and their text goes through `t()` (i18n); floating menus used inside modals (the Ask AI menu in the Gaps panel and Gap hunt) use the Popover API (top layer); logic gets Vitest tests (PGlite for server code, `// @vitest-environment node`).
- Dependencies, lazy only: `@xyflow/react` (version 12 or later, with `colorMode`) and `@dagrejs/dagre` (the maintained fork; the old `dagre` package is unmaintained).

## 7. How it works today (checked in the code)

- Master content: `{ title, sections: [{ id, title, entries: [{ id, text, cardId? }] }], status? }` (`src/logic/master/masterModel.ts`).
- **`cleanMaster` is not the only place new fields are lost:** the note adapter `MasterNote.tsx` types its params as `title | sections | status` and replaces content with `cleanMaster(p)`; the MCP `contentOf` (`src/server/mcpMaster.ts`) returns only `title` and `sections`, and its save calls `cleanMaster({ title, sections })`.
- Entry to card is one `cardId`, read in many places (see 8.1 for the full list).
- The master note has its own study cards: one, or one per top-level section above 12 entries (`MasterCardContent { sectionId?, retired? }`), kept in step by `syncMasterCards` (client, `masterCards.ts`) and its server twin `syncPlan` (`mcpMaster.ts`). **Both key cards by `sectionId ?? ""`**, so a card without a `sectionId` is treated as the whole-master card; a reviewed card the plan no longer wants is suspended and marked `retired`, an unreviewed one is deleted.
- `/learn/:deckId/:params` already parses `weak.<noteId>` (`parseWeakDrillParam`, `activities.ts`) and `cram` (whole deck, `getCardsOf(deck)`); `weak.<noteId>` sets `learnAll` and uses `weakCardsForStudy`. Cards are sorted by creation date; time-critical cards go first; new versus review is picked at random by a ratio; daily caps and paused-deck exclusion apply unless `learnAll`.
- `LearnView` renders every note type with the rating buttons, leech and sibling rules (`siblingsToBury` works per note).
- The MCP study session stores only `deck_id`; `snapshot` filters cards by deck scope, so cross-deck cards are never served; `questionOf`/`answerOf` have no branch for relation cards.
- Strength colours come from `cardRecall` in `suggestRating.ts`, which counts an untested entry as 0.

## 8. Design

### 8.1 Data (all optional) and every place that must change

```
MasterNoteContent { title, sections, status?,
  concept?: string          // free label that groups masters
  related?: string[]        // other master note ids
  tips?: string             // short free text (max 2,000 characters)
  edges?: { id: string; from: string; to: string; label: string; relation?: true }[]
}
MasterEntry { id, text, cardId?, cardIds?: string[] }
MasterCardContent { sectionId?, retired?, edgeId? }     // a relation card has edgeId
```

- **Entries:** `linkedCardsOf(entry)` returns `[cardId, ...cardIds]` without repeats. `cardId` stays as the primary link (old data reads unchanged); `cardIds` holds the others. A save writes `cardIds` only when there are extra cards. Removing the primary link promotes the first of `cardIds`.
- **Edges** have stable ids so a relation card can point at one. `relation: true` is the opt-in flag: it is what `syncMasterCards` reads, so a retired relation card can be restored and a plain arrow never gets a card by accident.
- **Where `entry.cardId` is read today and must use `linkedCardsOf` (the build step lists each with a test):**
  - model: `masterModel.ts` (`isBlankEntry` would wrongly drop an entry that has only `cardIds`, `linkedCardIds`, `cleanMaster`, `takeEntry`, `parseMasterText`, `masterToText`, `planMasterCards` inputs);
  - Dexie side: `masterCards.ts` (`linkedStatesOf` returns one state per entry; it must return one per card and group by entry), `builderData.ts` (graph input, `unlinkMasterEntriesTo`), `builderOps.ts` (link, unlink, dangling, duplicates, orphans), `coverage.ts`, `activities.ts`;
  - server: `mcpData.ts` (`masterSections`, and the card view that emits `section_id`, which also gets `edge_id`), `mcpMaster.ts` (get, create, ops, suggestion, delete, and the idempotency request hash, which today covers only `[text, cardId]` and must include `cardIds` and edges), `mcpManage.ts` (card deletion cleanup and the card output that emits `section_id`), `mcpWrite.ts` (the leech tag and sibling burying on MCP review);
  - UI: `BuilderRows.tsx`, `RecallSweepModal.tsx`, `GapHuntModal.tsx`, `MasterReview.tsx` (live-query key), `MasterBuilderView.tsx`, the text editor in `MasterCardEditor.tsx`.
- **Text form:** `masterToText` writes the primary `cardId` only. `parseMasterText` (`takeEntry` matches a previous entry only by `cardId` or by exact text and returns fresh objects today) is changed to **copy `cardIds` from the matched previous entry**, with a test, so a text edit does not lose extra cards. Editing the text of an **unlinked** entry gives it a new id (no match), which drops its edges: the editor warns when that would drop an edge, and the builder UI (which keeps ids) is the recommended way to rename.
- **No field is lost on save (version skew included):** `cleanMaster` (one argument today) merges from the existing content and preserves unknown keys. Every place that rebuilds content from `{ title, status, sections }` is changed to spread the existing content: `MasterNote.tsx`, `MasterBuilderView.tsx` (two sites), `MasterCardEditor.tsx`, `mcpMaster.ts` (the op context holds only title and sections; two save sites) and `contentOf` (which already drops `status` today). The builder autosaves from a possibly stale note reference, so `updateNote` re-reads the row inside its transaction and writes only title, status and sections, so a concurrent MCP `set_edges` is not overwritten.
- **Version skew:** an older client treats a relation card (no `sectionId`) as a duplicate whole-master card and can delete or retire the real one (`masterCards.ts` keys by `sectionId ?? ""`). Build step 1 ships alone first and already changes `keyOf` to ignore any card that has `edgeId`; it also preserves unknown keys, so older and newer clients can coexist.
- **Partly dangling entries:** an entry is dangling only when all of its cards are gone; a missing extra card is reported as "missing card" and the fix removes just that id.
- **Validation (`validateMaster`):** at most 100 edges per master (and 40 per drawn diagram, see 8.3), labels at most 24 characters, no self edge, no duplicate pair, edge ends must be entries of this master; `related` ids must exist when written; `tips` at most 2,000 characters. Strict on writes, forgiving when drawing (an edge to a missing entry is skipped).
- **Entry changes keep edges consistent:** removing an entry drops its edges (the app asks first, and the MCP ops `remove_entry`, `remove_section` and `remove_dangling_entries` return `[edge_has_reviewed_card]` unless `force: true` when an edge with a reviewed relation card would go); only **merge and duplicate fixes** have a surviving entry, so only they rewire (`fixSameCardDuplicates`, `fixSimilarDuplicates`, `removeEntries`: their signatures take sections only today and change to take the edges too; a merge also merges the two entries' `cardIds`) and the MCP ops `remove_entry`, `remove_section`, `remove_dangling_entries` rewire the removed entry's edges to the surviving entry before deleting it (no self edges, no duplicate pairs). History restore (`restore_card_version`) re-plans cards and tolerates edges to entries that no longer exist (they are dropped).

### 8.2 The sheet: blocks built from cards

| Block | Built from | Read mode | Active mode (study these cards now) |
|---|---|---|---|
| Diagram | entries on edges | boxes coloured by strength; tap a box or arrow | what-if (8.6) |
| Key points | entries | list with strength | study the entry's cards |
| Examples | linked cards tagged `example` | the card with its answer visible | study those cards |
| Common mistakes | linked cards tagged `pitfall` | the mistake and the fix | study those cards |
| Tips | `tips` text | shown | none (notes) |
| Related concepts | `related` and the same `concept` | links to those masters with their strength | none in this phase |
| Next | the weakest entry or most overdue arrow | one tap into a session on it | the session |

- Roles come from the existing tag system (`example`, `pitfall`, `apply`); a card gets them in the tag editor or from the AI. **No new card type.**
- Active mode only opens a study session over that block's cards (8.4). Nothing here renders its own quiz, hides labels, or asks the learner to self-mark (that was the memory game).
- Read mode never writes. It prints (print stylesheet) and has a Present view: fullscreen, one box at a time in diagram order, the arrows read out, an "ask the room" prompt built from the arrows ("Why does A <label> B?", "What stops working if A fails?"), and a reveal of the answer and downstream boxes.

### 8.3 The diagram as a navigator (not a quiz)

- Drawn with `@xyflow/react` and `@dagrejs/dagre` in a lazy chunk (precache verified in the production build; the list view is the fallback). Box id = entry id; labels are the entry text, so the picture cannot disagree with the cards.
- **Limits, defined:** a *box* is an entry that is on at least one arrow; entries on no arrow are listed under the diagram. At most 25 boxes and 40 arrows per drawn diagram; the write-time validator limit is the master-wide 100. If a diagram has more than 40 arrows, it draws the first 40 by depth and lists the rest under the diagram (the validator does not know about drawing). A master has one diagram when it fits; otherwise one per top-level section, and an arrow to another section is drawn as a stub labelled with the target's section. A section with more than 25 boxes draws the first 25 by depth and lists the rest under the diagram. Depth is the longest path from a source; a cycle is broken by capping the iterations, and the arrow that closes it is drawn backwards. `MASTER_MAX_ENTRIES` (500) and the 12-entry card split are unchanged and unrelated.
- A box shows its section, card types (chips), strength, and "untested" when it has no reviewed card. Tapping opens the **entry panel**: every linked card (type, preview, recall, due, "also in <other master>"), "Study this entry", and "Add a card". Add a card opens the new-note page (`/new/:deckId?`, the query goes after the hash route) with a `link=<masterNoteId>.<entryId>` parameter. The hook point is the shared `useNoteCreation` hook (`NewNotesView` does not read the result): it reads `link` from `useSearchParams`, and after `createNote` (which returns only a note id) looks the new cards up with `db.cards.where("note")` and appends their ids to the entry's `cardIds`. Ask AI offers a draft.
- An arrow is dashed without a relation card and coloured by that card's strength with one. Tapping opens the **arrow panel**: make or remove the relation card.
- Authoring edges: a simple editor in the builder (from, to, short verb), and the AI draft (Phase 24). **AI-written edges** are saved by `set_edges` after the learner says yes in the chat (the server cannot verify it); the builder then shows every arrow and the note history (7 days today, 90 days after Phase 16.2) can undo a bad write. Only Phase 22 fusion drafts have a pending state in the app.
- Accessibility: xyflow provides focusable nodes and ARIA; the list view is the alternative.

### 8.4 Session: the real cards (route, queue, order)

- **Params** on `/learn/:deckId/:params` (`parseWeakDrillParam` is generalised to `parseMasterParam`, returning `{ kind, noteId, scope }`):
  - `master.<noteId>`: the daily session, due cards through the normal rules.
  - `master.<noteId>.entry.<entryId>` and `master.<noteId>.block.<example|pitfall|apply>`: **scoped study** for "Study this entry" and the active mode of a block. These use `learnAll` (like `weak.<noteId>`), because the normal rules drop reviewed cards that are not due yet and the session would end at once.
  - `cram.master.<noteId>`: practice, `learnAll` and `cram` (everything once, FSRS untouched).
  - `useDeckFromUrl` keys its live query on `deckId` only, so moving between `master.a` and `master.b` in one deck would keep stale params; the key includes the params.
- **Queue:** `masterCardsForStudy(noteId, scope)` in `builderData.ts`: unsuspended cards linked from the master's entries (any deck) plus its relation cards, filtered by the scope. The daily `master.<id>` session is **not** `learnAll`: due cards, new cards within the daily caps, paused decks excluded.
- **Order:** the existing sort function type takes only `sortOrder` (`CardSorting.ts`), so it cannot carry diagram data. The querier instead stamps `customOrder` on the card copies it returns (depth of the card's entry, sources first; relation cards by the depth of their target) and the session uses the existing `byCustomOrder`. Time-critical cards still go first, the new/review ratio still applies, and a deck set to random order still shuffles new cards, so the order is "diagram order where the study screen allows it", not a promise. Depth comes from a plain topological pass, not from `diagramLayout.ts`, so the diagram library stays out of the `/learn` chunk.
- **Rating:** the normal buttons, preview intervals, leech and sibling rules, and (Phase 22) the run counter, because it is the same `updateCardModel`.
- **Rules for relation cards in the shared master note:** `siblingsToBury` and `applyLeech` work per note today, and MCP review repeats the leech and burying logic in `mcpWrite.ts`, so both are changed (`applyLeech(card: {id, note}, action)` and `siblingsToBury` take no card content today, so each gains an `isMasterCard` input at every call site: `learn.ts`, `mcpWrite.ts` and the other `applyLeech` callers): (a) burying skips cards of master notes; (b) a leech on a relation card honours the preset's `leechAction`: `suspend` suspends **that card only**, `tag` tags nothing on the master note (a card has no tag of its own), and in both cases the card shows in Gaps by its lapse count.
- Feedback: diagram colours come from Dexie live queries and change after each answer. A card shared by two masters updates both. A card sits in the queue once even if two entries link it.

### 8.5 Relation cards (opt-in per arrow)

- A relation card is a card of the master note with `content.edgeId`; asked as "<A> —?→ <B>", answered with the verb and a sentence. It tests how parts connect, which a basic card rarely does.
- **`syncMasterCards` and `syncPlan` change together (client and server twins).** Existing keys are **unchanged** (`sectionId ?? ""`; `planMasterCards` returns `null | string`; the server's deterministic ids are built from `card:${key}`, so renaming keys would break idempotent retries). Only one key kind is added: `e:<edgeId>`, returned by `keyOf` whenever a card has `content.edgeId`; the wanted set includes `e:<edgeId>` for every edge with `relation: true`. Relation-card ids are `uuidv5("e:" + edgeId, noteId)` on **both** sides (the client has no user id, and the server's `replanRows` uses random ids today), so two devices cannot create duplicates; a deleted-then-re-flagged edge reuses the id, so the tombstone rule is checked in the build. A relation card whose edge is removed or un-flagged is deleted if never reviewed, otherwise suspended and marked `retired` (the existing rule); this also applies when an entry removal drops its edges.
- **One pure planner:** because the client planner runs on Dexie under jsdom and the server one on PGlite under node, one test cannot run both. The build extracts a pure `planCardChanges(existing, want)` into `src/logic/master/` that both call, and the parity test targets that.
- It never creates one by itself. Cap 30 per master.
- The note adapter `MasterNote.tsx` gets an `edgeId` branch: the question shows the two boxes with a hidden verb, and the answer shows only that relation (today the answer side shows the whole master).
- Tags are note-level, so a master tagged `apply` would make every relation card look like Apply evidence: Apply readiness counts **ordinary linked cards only**, never relation cards.
- Phase 22's "content edit resets the run" does not apply to master notes (`updateNoteContent` skips `type: master`, see Phase 22 7.3); a relation card's run resets only when its own edge is changed.

### 8.6 What-if (computed from the arrows, no AI)

- Pure `src/logic/master/whatIf.ts`: `downstream(edges, id)`; `scoreWhatIf(truth, predicted)` returns hit, missed, extra and an F1 score.
- Flow: tap a box to break it, tap everything you think is affected, check. A scenario needs at least 2 boxes downstream of the broken one; the app suggests only those. A master with no such scenario has Predict marked "not applicable" (8.7).
- **Predict evidence** is one synced setting row **per attempt**, `#predict.<noteId>.<uuid>` = `{ at, brokenEntry, f1 }`, so two devices never overwrite each other's attempts. Mean and last 20 are derived when read; writing a new attempt deletes the attempts beyond the newest 20. Deleting a master (app `deleteNote` and `delete_master_card`) deletes its attempt rows; attempts whose broken entry no longer exists are ignored and pruned. `SettingsValues` is a closed interface and `useSetting` reads one key, so these rows are **kept out of** `useSettings` (which reads and reduces the whole table, and would grow with up to 20 rows per master) and out of the server's `world()` settings load: they are read with `db.settings.where("key").startsWith("#predict.<noteId>.")` (client) and a prefix query on `changes` (server). The server's `load()` in `mcpData.ts` returns every settings row with no key filter, so `load` / `world()` must exclude `id LIKE '#predict.%'`, and `record_predict` writes through `putRows` with `tbl: "settings"`. `#` and `.` are valid keys and the sync key path is `key`. A what-if never touches a card schedule.

### 8.7 Readiness (the K/S idea, per concept)

Pure `src/logic/master/readiness.ts`, used by the app and the server:

| Dimension | Evidence | Untested | Not applicable |
|---|---|---|---|
| Recall | mean strength of entries that have a reviewed card | no entry has a reviewed card, **or more than 20% of the entries are untested** | never |
| Explain | mean strength of relation cards | relation cards exist but none is reviewed | the master has no arrows, or has arrows but no relation card (it is optional; shown as "none") |
| Predict | mean what-if F1 | a scenario exists and none was done | no scenario with 2 or more downstream boxes |
| Apply | mean strength of ordinary linked cards tagged `apply` | tagged cards exist, none reviewed | no card is tagged `apply` |

- **Entry strength with several cards = the strength of its weakest reviewed card** (the entry is only as remembered as its weakest card). The sheet shows the per-card numbers in the entry panel.
- "Ready to teach": Recall tested, and every applicable dimension tested and at least 75%. **Untested is not zero** (ADR 0012); the existing `suggestMasterRating` is unchanged (it counts untested entries as 0 for its own purpose, and the sheet shows both numbers with their labels).
- It is a quick local measure, not a replacement for K/S objectives; a master can be linked to an objective and the tutor skill can read these numbers (`get_master_card`).

### 8.8 Gaps, each with a fix

Reuses `analyzeCoverage` (orphans, dangling, empty, unlinked, stale, duplicates) and adds:

- entries tested by one card type only,
- arrows with no relation card,
- weak (under 60%) cards, and stuck cards (`run <= -stuckAfter`; **needs Phase 22**, omitted until it exists),
- cards of the deck that sit in no master.

Fixes: study the weakest (`weak.<noteId>`), make a relation card, add a card (editor), or Ask AI. Nothing changes without the learner's click.

### 8.9 Concept group and related masters

`concept` groups masters across decks; the Masters tab and deck page group by it; the concept view shows the masters of one concept as tabs with a strength bar each, the weakest highlighted, and "next" pointing at it. Labels are trimmed, spaces collapsed, matched case-insensitively, stored as first typed. `related` links by id (a picker in the builder; the AI can suggest).

### 8.10 Human, assistant and Ask AI for each part (parity)

| Part | Human UI | MCP | Ask AI |
|---|---|---|---|
| Read the sheet | sheet, print, Present | `get_master_card` returns blocks, edges, entry cards with state, readiness | none needed |
| Test with the cards | `/learn/.../master.<id>` | `start_study_session` with `master_id` (8.12) | `master.session` |
| Relation cards | arrow panel, gaps panel | `update_master_card` op `set_relation_cards` | `master.relations` |
| What-if | what-if panel | `get_master_card` returns arrows; the skill poses scenarios; op `record_predict` writes an attempt row | none needed |
| Diagram edges | edge editor | op `set_edges` | `master.draft_diagram` |
| Gaps | gaps panel | `master_coverage` extended | `master.fill_gaps`, `cards.add_variety` |
| Concept, related, tips | builder fields | ops `set_concept`, `set_related`, `set_tips` | none needed |
| Many cards per entry | entry panel, picker | `add_entry` and `link_entry` (the existing master ops) accept a list | none needed |

No part is done until the human and MCP columns both exist and every AI-needing row has its Ask AI action. Diagram drawing, Present and print are human-only by nature.

### 8.11 Phase 22 dependencies

The Gaps "stuck" check and any run-based hint need the Phase 22 run counter. Everything else in this phase works without it.

### 8.12 MCP changes (the part the first version missed)

- **Migration:** add `master_id text` to `mcp_study_sessions` (a new timestamp-named file in `supabase/migrations/`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; the table already has row security). Phase 16.2 adds `tags jsonb` to the same table in its own migration.
- **Serving cross-deck cards:** `snapshot` filters by deck scope, so with `master_id` the study picker (`pickNext`, `emptyReason`) loads the master's linked card ids directly instead of filtering by deck. These sessions still apply, per `card.deck`, the Phase 16.1 per-deck new-card budget (`new_budget`), the exclusion of paused decks, and the Phase 22 catch-up clamp.
- **Relation cards over MCP:** `questionOf` and `answerOf` (`mcpStudy.ts`) and `masterSuggestion` get an `edgeId` branch so a relation card is not asked as "recall everything".
- `contentOf` spreads the existing content; `get_master_card` returns `concept`, `related`, `tips`, `edges`, entries with all their cards and states, and readiness; `delete_master_card` also deletes the `#predict.<noteId>.*` rows.
- New ops on `update_master_card` (all checked with the same `validateMaster`): `set_edges`, `set_relation_cards`, `set_concept`, `set_related`, `set_tips`, `record_predict`. The 50-card and request-size limits of `add_cards` do not change.
- **Tests:** seven MCP test files hard-code their migration lists (`appApi`, `mcpEvidence`, `mcpInstructions`, `mcpManage`, `mcpMaster`, `mcpStudy`, `noteHistory`); each gets the new migration.
- Skill text changes are seeded only into an empty database (`adr/0006-skills-in-postgres-served-over-mcp.md`): the owner's live default skill must be updated by hand at `/skills/edit` or with `update_skill_file` (scope `default`). Acceptance for each skill step: `get_skill` returns it.

## 9. What changes where

| Area | Change |
|---|---|
| `src/logic/master/masterModel.ts` | new fields, `linkedCardsOf`, merge-preserving `cleanMaster`, `validateMaster`, text round trip |
| `masterCards.ts`, `builderData.ts`, `builderOps.ts`, `coverage.ts`, `activities.ts`, `suggestRating.ts` | all cards of an entry; edge rewiring; `masterCardsForStudy`; `parseMasterParam`; relation-card keys in `syncMasterCards` |
| `src/logic/master/whatIf.ts`, `readiness.ts`, `diagramLayout.ts` (new) | pure logic with tests |
| `src/logic/type-implementations/master/` | `edgeId` branch (question and answer), merge-preserving params |
| `src/app/learn/LearnView/useLearnSession.ts`, `src/logic/card/cardControls.ts`, `policy.ts` | master sessions switch the hard-coded `sort: CardSorts.byCreationDate(1)` to the existing `byCustomOrder(1)` and add the parsed master scope to the hook's `dependencies`; sibling burying and leech skip master relation cards (signature changes, see 8.4) |
| `src/app/learn/LearnView/` | `master.<id>` and `cram.master.<id>` |
| `src/app/master/` | sheet, entry and arrow panels, lazy diagram, what-if, gaps, concept view, Present, edge editor, print CSS, grouping in `DeckMastersSection.tsx` |
| settings | `#predict.<noteId>.<uuid>` with a template-literal key type |
| `src/server/mcpMaster.ts` (`syncPlan`, `contentOf`, ops, get, delete), `mcpStudy.ts`, `mcpData.ts` | as in 8.12 |
| `supabase/migrations/` | one: `mcp_study_sessions.master_id` |
| `src/server/skillSeed.ts` (`skola`: arrows, relation cards, what-if and session-in-chat steps) and `skillSeedLearning.ts` (`skola-quality-auditor`, `skola-card-architect` additions); then update the live skills |
| `package.json`, `next.config.mjs`, `src/sw.ts` | `@xyflow/react`, `@dagrejs/dagre`; confirm the chunk is precached; offline test |
| tours, InfoTips, `docs/features.md`, `docs/architecture.md`, `docs/gotchas.md`, `docs/fsrs-and-presets.md`, HANDOFF, SPEC row | updated with each step |

## 10. Build order and done criteria

1. **Data first, nothing visible.** Many cards per entry, new fields, merge-preserving `cleanMaster`, `MasterNote` and `contentOf` spreading, all `cardId` sites on `linkedCardsOf`. *Done when:* a round trip keeps unknown fields; old data reads and saves unchanged; coverage, suggested rating and MCP reads handle many cards per entry; tests cover each listed file. Ship this alone first.
2. **Session over a master:** `parseMasterParam`, `masterCardsForStudy`, order through `customOrder`, practice via cram, MCP `master_id` with its migration. *Done when:* a master with cards in two decks serves them in app and MCP, due and new rules hold, cram writes nothing, `pnpm build` passes.
3. **Sheet, entry panel, read mode,** list view, tags as roles, print. *Done when:* each block renders from fixtures (tags, entries, related, tips); read mode writes nothing (asserted); Add a card links the new card to its entry; `pnpm build` passes.
4. **Diagram,** edge editor, edge rewiring on entry changes, lazy chunk, precache and offline check, `pnpm build`. *Done when:* arrows render from fixtures, the 25-box and 40-arrow caps hold, merge and removal edge tests pass, and the diagram chunk is in the precache and loads offline.
5. **Relation cards:** `syncMasterCards` and `syncPlan` parity, `MasterNote` branch, leech and sibling rules, arrow panel. *Done when:* a parity test shows client and server plan the same cards for the same master, including retired and restored ones.
6. **What-if, readiness, gaps,** Present. *Done when:* `scoreWhatIf` and `readiness` tests cover every cell of the table in 8.7 (untested, not applicable, ready); attempt rows are kept out of `useSettings`; each Gaps fix works; Present steps through a fixture master.
7. **Concept group and related masters.** *Done when:* the label normalisation tests pass (case, spaces), the concept view lists the masters across decks, `related` ids that no longer exist are dropped.
8. **MCP ops and skill steps,** live skill updated. *Done when:* every op has a PGlite test including an idempotent retry (the request hash covers `cardIds` and edges), the seven test files carry the migration, and `get_skill` returns each new step.
After each: `pnpm exec biome check --write`, `pnpm lint:type`, `pnpm test`; `pnpm build` for steps 2 and 4; a browser check for every UI step.

## 11. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Lens over the learner's cards, real study screen for testing, relation cards opt-in** | One review engine, honest SRS, no double authoring; needs many cards per entry and care with the card plan | **Chosen** |
| B. Separate Revise engine with self-marked entries | Quick; a memory game; two review paths | Rejected by the owner |
| C. Standalone lesson pages | Reads well; doubles the work and cuts the link to cards | Rejected |
| D. Raw Mermaid text | AI-friendly; heavy, hard to mask or validate | Rejected |
| E. Relation cards for every arrow | No effort; card explosion | Rejected; opt-in |

## 12. Decisions and calls

Settled by the owner (2026-11-07): originals stay in study and linked; `@xyflow/react`; assistants reached by copy-and-open prompts (Phase 24); flow diagrams first.

My calls (check these):
1. Testing is `/learn` on the real cards; no self-marked mode exists.
2. An entry links to many cards; `cardId` stays as the primary link.
3. Sheet roles come from the tags `example`, `pitfall`, `apply`.
4. Relation cards are cards of the master note keyed `e:<edgeId>`, opt-in via `relation: true`, at most 30.
5. Predict evidence: one settings row per attempt, newest 20 kept.
6. Readiness: Recall plus every applicable dimension at 75%; not-applicable dimensions are excluded; untested is not zero.
7. A what-if scenario needs at least 2 downstream boxes.
8. `concept` is a free label; the hierarchy is unchanged.
9. A diagram holds at most 25 boxes (entries on arrows) and 40 arrows; bigger masters get one per section.
10. Edges are AI-drafted and learner-approved; a bad write is undone from note history.
11. The session order is diagram order within the existing new/review mix, not strict.
12. Sibling burying skips master notes; a leech on a relation card suspends that card only.

## 13. Metrics (after release)

Time from opening a master to seeing its weakest entry (aim under 5 seconds); share of masters with a relation card and how often those are rated Again versus basic cards; whether the strength colours predict the next real review; how many masters reach "ready to teach" and whether the Gaps fixes are used.

## 14. Left to the builder

Visual design of boxes, tiles and arrows, keyboard shortcuts, print layout, tooltip and toast copy, test names, Dexie query shapes.
