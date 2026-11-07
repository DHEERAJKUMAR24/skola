# Phase 16: MCP deck ergonomics, pacing and study notes (corrected design)

- **Status:** DESIGN, rewritten on 2026-11-07 after an independent code review showed the Phase 16 text in `docs/spec-comparison-flash-deep.md` was built on assumptions about Skola that are false. Waiting for the owner's approval. Nothing is built.
- **Supersedes:** the Phase 16.1, 16.2 and 16.3 parts of `spec-comparison-flash-deep.md` (section 7), its section 9 (AI-first patterns), and its sections 11.1 to 11.8, wherever they differ from this file. The tool-by-tool comparison tables there stay as reference only.
- **Phase:** 16.1, 16.2 and 16.3 in `docs/SPEC.md`.

## 1. Facts about Skola that the old text got wrong (verified in the code)

| Old assumption | Reality |
|---|---|
| Decks have `parent_id`; recursive CTE; an `archived_at` column and a `decks` migration | Decks are JSON rows in `changes` (`data` jsonb). A deck has `subDecks` and `superDecks` (the full ancestor chain), no `parent_id` (`src/logic/deck/deck.ts`). Paths are built from `superDecks` names (`src/server/mcp.ts`). `decks` is already synced. No migration is needed for any deck change |
| `archive_deck` is a new concept | `Deck.priority` is `"studying" \| "paused"` and `update_deck` already pauses a deck (`mcpManage.ts`). A second archive flag would duplicate it |
| MCP sessions respect daily limits and an account-wide new-card pool | MCP applies no preset limits: sessions use caller-supplied `limit` and `new_limit` (defaults 20 and 5, `mcpStudy.ts`). Only the app applies `newCardsPerDay` per deck (`limitNewCards`, `useTodayActivity`). There is no account-wide pool and no `account_defaults` |
| `set_limits` sets a deck-level override | A deck's inline options are overridden by its preset once `presetId` is set (`effectiveOptions.ts`); editing the preset changes every deck that shares it |
| `start_study_session` has a `tag` parameter | It takes `deck_id`, `limit`, `new_limit`. Only `list_cards` has `tag`. Sessions persist only `deck_id` |
| `mcpError()` with `data.code`; confirm tokens with a 10-minute TTL | Errors are `StudyError` or `ManageError`, formatted `[code] message` in result text; `RpcError` is protocol-level only. Confirm tokens are stateless sha256 (no TTL, no per-client scope) |
| `previewNextInterval` must be written | `scheduleCard()` already returns the `RecordLog` for ratings 1 to 4 without writing (`policy.ts`, used in `mcpWrite.ts`) |
| HTML card fields need a Dexie change | Notes already store TipTap HTML; the MCP escapes plain text (`mcpNotes.ts`). Accepting HTML needs a sanitizer dependency, not a schema change |
| `basic_typed` is an MCP-only note type | A new `NoteType` breaks `Record<NoteType, string>` in `card.ts` and `NoteTable.tsx`, plus `NoteContent`, `CardContent`, `NoteTypeAdapter`, and needs an editor and a study typing UI |
| Limits: 500 cards per call, 20 ids | Real: `MAX_NEW_CARDS = 50` (capped by Vercel's request size), `MAX_IDS = 200`, text 10,000 characters |
| A `server_state` table to sign media URLs; `list_tags` is new | `crypto.ts` already has `hmac()`, and R2 presigning exists; `list_tags` is already shipped (`mcpManage.ts`) |
| Tool code goes in `mcpNotes.ts` / `pg.ts` | `add_cards` is in `mcpWrite.ts`; `src/server/pg.ts` does not exist; history retention is `HISTORY_DAYS = 7` in `src/server/noteHistory.ts`; `mcpManage.ts` (1,198 lines) and `mcpMaster.ts` (1,533 lines) are too big to grow, so new deck tools go in a new `mcpDecks.ts` |

## 2. Scope (recommended; the owner can change it)

| Item | Verdict | Why |
|---|---|---|
| 16.1 deck paths, rename and re-parent, daily limits for MCP sessions, boost, get_limits, set_limits, notes on tool responses, comes_back_in_ms, error codes, grading_mode | **Build** | Small, cheap, fixes real friction in AI-driven study |
| `archive_deck` / `unarchive_deck` | **Cut** | Duplicates `paused` |
| `list_decks` goal data | **Defer** | Needs a pacing model that conflicts with the existing exam-date logic (`examBufferDays`, `examRamp`) |
| 16.2 `tags[]` filter, history 90 days / 20 versions | **Build** | Cheap and useful |
| 16.2 `basic_typed`, speech blocks, HTML fields | **Defer** | Cross-cutting app changes; Flash parity, not an owner need |
| 16.3 panel bridge, signed media proxy, `panel_reminders`, `server_state` | **Defer** | No MCP-UI contract exists in the code (see 5) and reminders need a cron |

## 3. Constraints

Local-first; no cron or polling; FSRS policy unchanged; tests for every behaviour (PGlite for server code); new settings get `SettingsValues` and `defaultSettings` entries (there is no server whitelist for setting names, only for tables); skill text changes must be delivered to the live database by hand (ADR 0006) and verified with `get_skill`; docs updated with each step.

## 4. Design

### 4.1 Deck paths, rename and re-parent (`src/server/mcpDecks.ts`, new)

- `resolveDeckPath(ctx, input, { createMissing })`: input is a deck id or a path `Parent::Child` (also `Parent / Child`). Names match case-insensitively among siblings; if two siblings differ only by case, creating a third is refused with `[deck_name_taken]`. Missing ancestors are created only when `createMissing` is true, and the result lists what was created. Names at most 100 characters (the existing `create_deck` rule). Used by `create_deck` (`parent` accepts a path), `add_cards` (a `deck` path), `list_cards`, `move_cards` and the new tools.
- `rename_deck(deck, name?, parent?)`: renames and/or re-parents. Re-parenting rewrites `superDecks` for the deck and every descendant, and `subDecks` on the old and new parent, in one `putRows` call (decks sync as whole rows; each gets a fresh `updatedAt`). Refuses: a move into the deck's own descendants (`[deck_cycle]`), a duplicate sibling name (`[deck_name_taken]`), a missing parent. Returns the old and new path and the number of decks changed.
- No Postgres migration and no Dexie version: the fields already exist and are synced.
- **Done when:** PGlite tests cover case rules, auto-create and its report, rename, re-parent with descendants, cycle refusal, and that the app reads the result (`superDecks` consistent for every descendant).

### 4.2 Daily limits for MCP sessions, boost, get_limits, set_limits

- **Server-side limits (new behaviour):** `start_study_session` and `get_due_cards` compute, per deck, the effective `newCardsPerDay` (preset, via the same field resolution as `effectiveOptions.ts`), plus today's boost, minus new cards already seen today. "Seen today" is counted from the synced `reviewLogs` rows whose state before the answer was New, since the logical day start (`#newDayStartHour`, `logicalDayStart` in `policy.ts`); it is as fresh as each device's last sync and the output says so. A caller's `new_limit` can only lower the result. A session's `limit` stays a cards-per-session cap.
- **`boost_new_today(deck, extra 1 to 500)`:** stored in the synced setting `#dailyBoosts` = `{ date: "YYYY-MM-DD", byDeck: { [deckId]: number } }` (logical date). The app adds it in `effectiveOptions` / `limitNewCards` for that deck; the server adds it in 4.2 above. A boost for another date is ignored and replaced on the next write. App UI: a deck menu item "Add extra new cards today" with an `InfoTip`.
- **Precedence** (also in `spec-targeted-review.md`): preset, then boost, then catch-up (Phase 22), which overrides both.
- **`get_limits(deck?)`:** per deck: effective new per day, reviews per day, boost, new seen today (as of last sync), remaining, exam date, and the catch-up state when Phase 22 exists.
- **`set_limits(deck, new_per_day?, reviews_per_day?, goal_date?)`:** updates the deck's **preset** fields (`newCardsPerDay`, `maxReviewsPerDay`; the build confirms the exact names in `presets.ts`) and the deck's `examDate` (local `YYYY-MM-DD`). If the preset is shared by other decks it refuses with `[preset_shared]` and lists them, unless `unshare: true`, which clones the preset (named after the deck) and re-points this deck. Never writes an inline override that the preset would hide.
- **Done when:** tests for the day boundary and DST (using the logical-day function), boost reset on a new date, session limits with and without boost, `new_limit` only lowering, shared-preset refusal and clone, and the app's `limitNewCards` honouring a boost.

### 4.3 Notes on tool responses, interval preview, error codes

- `Ctx` gains `base` (the site origin; `handleRpc` already receives it for `initialize`) so tools can include links.
- `start_study_session` and `next_card` return a short `note` chosen from four states (cards waiting, held by the daily limit, caught up, nothing to study) so the assistant can tell the learner what is going on; `end_session` adds the app link.
- `show_answer` returns `comes_back_in_ms` for ratings 1 to 4 from the existing `scheduleCard()` `RecordLog` (no new scheduler code).
- **Errors:** keep the `[code] message` convention. `tools/call` in `mcp.ts` adds `structuredContent: { code }` when the message starts with `[code]`, so clients can branch on it. The old ADR 0022 vocabulary (expiring confirm tokens, per-client scoping) is dropped because confirm tokens are stateless.
- **Done when:** tests assert each `note` state, the four intervals, and `structuredContent.code` on a failing call; the `tools/list` snapshot test is updated for any changed description.

### 4.4 `grading_mode`

- Values `silent` (grade without telling), `announce` (say the grade), `self_grade` (ask the learner to grade). A `start_study_session` argument, defaulting from the synced setting `#gradingMode` (added to `SettingsValues` and `defaultSettings`), returned in the session responses, and written into the session note text so the assistant follows it.
- App: a picker on the Settings, AI assistants tab with an `InfoTip`. It is a behaviour preference for the assistant, not an assessment framework (that is K/S, ADR 0012).
- **Done when:** the setting round-trips, the session reports the mode, and the three skill texts mention it (delivered to the live skill and verified with `get_skill`).

### 4.5 16.2: tag filter and history

- **`tags[]` on `start_study_session`:** up to 10 tags, AND match. Sessions persist only `deck_id`, so a migration adds `tags jsonb` to `mcp_study_sessions` (timestamp-named file, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, row security already on). The filter is applied in `pickNext` and `emptyReason`, not in the shared `snapshot` used by other tools. Phase 23 adds `master_id` to the same table in its own migration.
- **History retention 7 days to 90 days and 20 versions:** `HISTORY_DAYS` in `src/server/noteHistory.ts` and the app's history code; the prune keeps the newest 20 versions per note and drops versions older than 90 days, but always keeps the newest old version (the existing "never empty for an old note" rule). Update ADR 0011 (amended), the `NoteHistoryModal` copy, the `card_history` and `restore_card_version` descriptions, and the free-tier storage estimate in `SPEC.md` (text only, a small cost).
- **Done when:** tests for the AND filter, the 10-tag cap, the empty-reason message, the prune rule at 20 versions and at 90 days, and that restore still works.

## 5. Deferred, with the reason written down

- **16.3 panel bridge.** `tools/list` builds only `readOnlyHint` and `destructiveHint`; `annotations: { audience: ["app"] }` is not an MCP tool annotation; `initialize` advertises no `extensions` capability; `resources/list` serves skills only; the stateless POST route cannot remember which client supports UI; no UI bundle or `ui://` resource is specified; all seven panel tools would only wrap existing study tools. Redo it against the real MCP Apps contract if a client the owner uses supports it.
- **`panel_reminders` and `#reminderConfig`:** nothing can fire a reminder without a cron or push, which the project forbids.
- **`server_state` and `/api/mcp-media`:** media URLs can be signed with the existing `hmac()` and R2 presigning; no table.
- **`basic_typed`, speech blocks, HTML fields:** each changes the app (types, editors, study screens), and speech blocks would be lost on any app edit because `updateNoteContent` writes content wholesale. Specify them separately if wanted.
- **`list_decks` goal data and the 11.4 pacing algorithm:** conflicts with the existing exam-date logic; pick one model first.
- **Cut:** `archive_deck`, `unarchive_deck`, renaming the `reverse` type (it would break the seeded skills and existing clients), the 1 MiB MCP body limit (conflicts with image uploads), connector-scoped confirm tokens, per-call telemetry.

## 6. Build order and tests

1. `mcpDecks.ts`: `resolveDeckPath`, `rename_deck`, and path support in the tools that take a deck.
2. Server-side daily limits for sessions, `boost_new_today` (app and server), `get_limits`, `set_limits`.
3. `Ctx.base`, notes on responses, `comes_back_in_ms`, `structuredContent.code`, `grading_mode`.
4. 16.2: `tags[]` migration and filter; history retention.
After each: `pnpm exec biome check --write`, `pnpm lint:type`, `pnpm test`; `pnpm build` for any step touching routes or config; a browser check for the app UI pieces (boost menu item, grading picker). Update HANDOFF, SPEC, `docs/features.md` and the skills (delivered to the live skill) with each step.

## 7. Calls I made

1. Cut archive (it duplicates paused). 2. Daily limits for MCP sessions are new behaviour, counted from synced review logs (as of last sync). 3. `set_limits` edits the preset and refuses on a shared preset unless told to clone. 4. Keep the `[code]` error convention and add `structuredContent`. 5. 16.3, `basic_typed`, speech, HTML and goal data are deferred. 6. New deck tools live in `mcpDecks.ts`.
