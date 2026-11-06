# 0014. Master card (accepted, core built)

Date: 2026-11-03
Status: Accepted (core and MCP tools built 2026-11-06; builder UI, graph view and activities still to do)

## Context
Owner's definition: a master card is a group of cards in a deck that covers every concept and fact in that deck with nothing left out, kept as a compact list (auto-generated over MCP or written by hand). Most of the owner's work will happen on master cards, so it needs the most engineering.

## Decision (agreed design)
- A real note type with its own note and cards. It is a full card (everything a normal card can do) plus master activities. It syncs through the existing sync, with no server tables.
- Many per deck; sub-decks have their own; cards link to them by card id. One card per top-level section above about 12 entries.
- A coverage engine finds orphan, dangling, empty, stale and duplicate entries.
- Rating: the user self-rates and the app also shows a suggested rating.
- Hierarchy levels are user-defined (default domain, subject, chapter, concept) with roles deck, master, section, entry, stored as a synced setting. Profile instructions tell assistants about it.
- Any card can link to any card, and cross-deck links are allowed from a graph view. General links stay note level (`linkedNotes`).
- Order: UI first, MCP second. Build order: hierarchy setting and editor, coverage engine, master note type and review, builder UI, graph view and linking, activities, MCP tools, skills and docs.

## Decided (2026-11-06)
- General links between cards stay note level (`linkedNotes`). An entry links to a card by card id, and any card of any deck may be linked; coverage only counts the master's own deck.
- Domain and Subject map to nested decks. Default hierarchy: Domain (deck), Subject (deck), Chapter (section), Concept (entry). A `master` role exists for users who want a level for it; most leave it out.

## Built
- `#hierarchy` synced setting and settings page (`src/logic/settings/hierarchy.ts`).
- Pure engines in `src/logic/master/`: model and text form, coverage, suggested rating. No Dexie imports, so the MCP server can reuse them.
- Note type `master`: one card up to 12 entries, one card per top-level section above that (needs two sections). Dropped cards are deleted if never reviewed, else suspended and `retired`, so history is never lost.
- Study answer shows entries plus a suggested rating; the user always self-rates with the normal buttons.
- Minimal creation (deck menu) and a card picker.
- MCP tools (`src/server/mcpMaster.ts`, no Dexie, pure modules reused): `create_master_card` (sections written by the assistant, or `from_deck` grouped by first tag or one section, with `dry_run`; `idempotency_key` makes note, section, entry and card ids deterministic and stores a request hash in `note.mcpRequest`; same key with other content is `[idempotency_conflict]`), `get_master_card`, `list_master_cards`, `update_master_card` (ops list applied all or nothing; the card plan is `syncPlan`, the server twin of `syncMasterCards`: unreviewed dropped cards are deleted, reviewed ones suspended and `retired`, retired ones return; `idempotency_key` kept on the note as `mcpUpdate`), `master_coverage` (`analyzeCoverage` plus ready `fix_ops`: add orphans, remove dangling entries and empty sections), `suggest_master_rating`, `delete_master_card` (confirm token over the exact sections, entries and study cards; linked cards are never deleted). Replies carry `labels` and `summary` in the user's `#hierarchy` names (read from the settings row like `#aiInstructions`). Writes use `putRows`, so edits land in the 7-day note history.
- Other tools know the type: search and list read entry text, study sessions ask a recall question and show entries plus a suggested rating (reference only, never submitted for the learner), `edit_card` points to `update_master_card`, `delete_cards` refuses a master's own study cards and previews `linked_from_masters`, `restore_card_version` re-plans the cards, `find_similar_cards` skips masters.
- **`get_master_card` repurposed.** It was a deprecated alias of `get_objective_overview` (the objective tool renamed on 2026-11-06). The alias is removed. `get_master_card` now returns a real master (`master_id` or a study `card_id`). A call with `objective_id` and no master id returns `[renamed_tool]` naming `get_objective_overview`. The tool description and the skills say so. Skills installed from before still work for everything except that one call.

## Built (app UI, 2026-11-06)
Builder page, graph view, recall sweep, gap hunt, weak-spot drill, optional `status` on master content. Not checked in a browser.

## Open
Still to build: builder UI, graph view, master activities. Sub-deck inclusion in coverage is off on purpose (each sub-deck has its own master).

## Consequences
Masters sync as ordinary notes and cards, so no server tables or migration. The server knows the `master` type since the MCP step (see Built); before it, tools that switch on the note type fell through to their default.
