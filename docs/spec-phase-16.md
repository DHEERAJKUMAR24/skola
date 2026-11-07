# Phase 16: MCP deck ergonomics, pacing and study notes (corrected design)

- **Status:** DESIGN, rewritten on 2026-11-07 after an independent code review showed the Phase 16 text in `docs/spec-comparison-flash-deep.md` was built on assumptions about Skola that are false. Waiting for the owner's approval. Nothing is built.
- **Supersedes:** the Phase 16.1, 16.2 and 16.3 parts of `spec-comparison-flash-deep.md` (section 7), its section 9 (AI-first patterns), and its sections 11.1 to 11.8, wherever they differ from this file. The tool-by-tool comparison tables there stay as reference only.
- **Phase:** 16.1, 16.2 and 16.3 in `docs/SPEC.md`.

## 1. Facts about Skola that the old text got wrong (verified in the code)

| Old assumption | Reality |
|---|---|
| Decks have `parent_id`; recursive CTE; an `archived_at` column and a `decks` migration; `rename_deck` is a new tool | Decks are JSON rows in `changes` (`data` jsonb). A deck has `subDecks` and `superDecks` (the full ancestor chain). Paths are built from `superDecks` names (`src/server/mcp.ts`). `decks` is already synced. **`update_deck` already renames, re-parents (its argument is `parent_id`), rewrites descendants' `superDecks` and both parents' `subDecks`, and refuses cycles with `[invalid_move]`** (`mcpManage.ts`). No migration is needed for any deck change |
| `archive_deck` is a new concept | `Deck.priority` is `"studying" \| "paused"` and `update_deck` already pauses a deck (`mcpManage.ts`). A second archive flag would duplicate it |
| MCP sessions respect daily limits, paused decks and the learner's time zone, and there is an account-wide new-card pool | MCP applies no preset limits and **ignores paused decks** (`pickNext` and `snapshot` have no `priority` filter): sessions use caller-supplied `limit` and `new_limit` (defaults 20 and 5, `mcpStudy.ts`). Only the app applies `newCardsPerDay` per deck (`limitNewCards`, `useTodayActivity`). There is no account-wide pool and no `account_defaults`. The server has no time-zone handling at all: `logicalDayStart` (`policy.ts`) uses the process's local zone, which on Vercel is UTC |
| `set_limits` is a new capability | `update_preset` already edits `new_cards_per_day` and `max_reviews_per_day` and `update_deck` already sets `exam_date` (`mcpManage.ts`). A deck's inline options are overridden by its preset once `presetId` is set (`effectiveOptions.ts`); editing a shared preset changes every deck that shares it, and **every deck starts on the shared preset `default`** (`presets.ts`) |
| `start_study_session` has a `tag` parameter | It takes `deck_id`, `limit`, `new_limit`. Only `list_cards` has `tag`. Sessions persist only `deck_id` |
| `mcpError()` with `data.code`; confirm tokens with a 10-minute TTL | Errors are `StudyError` or `ManageError`, formatted `[code] message` in result text; `RpcError` is protocol-level only. Confirm tokens are stateless sha256 (no TTL, no per-client scope) |
| `previewNextInterval` must be written, or `scheduleCard` is trivially reusable | `scheduleCard()` returns the `RecordLog` for ratings 1 to 4 without writing, **but it needs a `ScheduleContext` (decks, presets, settings, `resolveExam`, global FSRS, `cardOverride: card.fsrsOverride` and `newDayStartHour`) that `gradeCard` builds inline** (`mcpWrite.ts`); `show_answer` (`mcpStudy.ts`) has none of it. A shared helper must be extracted first |
| HTML card fields need a Dexie change | Notes already store TipTap HTML; the MCP escapes plain text (`mcpNotes.ts`). Accepting HTML needs a sanitizer dependency, not a schema change |
| `basic_typed` is an MCP-only note type | A new `NoteType` breaks `Record<NoteType, string>` in `card.ts` and `NoteTable.tsx`, plus `NoteContent`, `CardContent`, `NoteTypeAdapter`, and needs an editor and a study typing UI |
| Limits: 500 cards per call, 20 ids | Real: `MAX_NEW_CARDS = 50` (capped by Vercel's request size), `MAX_IDS = 200`, text 10,000 characters |
| A `server_state` table to sign media URLs; `list_tags` is new | `crypto.ts` already has `hmac()`, and R2 presigning exists; `list_tags` is already shipped (`mcpManage.ts`) |
| Tool code goes in `mcpNotes.ts` / `pg.ts` | `add_cards` is in `mcpWrite.ts`; `src/server/pg.ts` does not exist; history retention is `HISTORY_DAYS = 7` in `src/server/noteHistory.ts`; `mcpManage.ts` (1,198 lines) and `mcpMaster.ts` (1,533 lines) are too big to grow, so new deck tools go in a new `mcpDecks.ts` |

## 2. Scope (recommended; the owner can change it)

| Item | Verdict | Why |
|---|---|---|
| 16.1 deck paths (inside the existing tools), daily limits and paused decks for MCP sessions, boost, get_limits, set_limits (thin), notes on tool responses, comes_back_in_ms, error codes, grading_mode | **Build** | Small, cheap, fixes real friction in AI-driven study |
| `rename_deck` | **Cut** | `update_deck` already does it |
| `archive_deck` / `unarchive_deck` | **Cut** | Duplicates `paused` |
| `list_decks` goal data | **Defer** | Needs a pacing model that conflicts with the existing exam-date logic (`examBufferDays`, `examRamp`) |
| 16.2 `tags[]` filter, history 90 days / 20 versions | **Build** | Cheap and useful |
| 16.2 `basic_typed`, speech blocks, HTML fields | **Defer** | Cross-cutting app changes; Flash parity, not an owner need |
| 16.3 panel bridge, signed media proxy, `panel_reminders`, `server_state` | **Defer** | No MCP-UI contract exists in the code (see 5) and reminders need a cron |

## 3. Constraints

Local-first; no cron or polling; FSRS policy unchanged; tests for every behaviour (PGlite for server code); new settings get `SettingsValues` and `defaultSettings` entries (there is no server whitelist for setting names, only for tables); skill text changes must be delivered to the live database by hand (ADR 0006) and verified with `get_skill`; docs updated with each step.

## 4. Design

### 4.1 Deck paths inside the existing tools (`src/server/mcpDecks.ts`, new)

- `resolveDeckPath(ctx, input, { createMissing })` lives in a new file (`mcpManage.ts` is already 1,198 lines). Input is a deck id or a path `Parent::Child` (also `Parent / Child`). Names match case-insensitively among siblings. A path that matches several decks (legacy duplicate sibling names) returns `[deck_ambiguous]` with the candidate ids. Missing ancestors are created only when `createMissing` is true, and the result lists what was created.
- **Names may not contain `::`** (rejected in `create_deck`, `update_deck`, **the app's own create and rename deck dialogs**, and CSV import) so a path is never ambiguous; sibling names that differ only by case are refused with `[deck_name_taken]` on create and rename.
- Wired into the tools that take a deck: `create_deck` (`parent_id` accepts an id or a path), `add_cards`, `list_cards` and `move_cards` (their `deck_id` accepts an id or a path), `update_deck` (`parent_id` accepts an id or a path). `list_decks` today joins paths with `" / "`; it prints `::` paths instead, so a name containing a slash is never ambiguous. **`update_deck` already renames and re-parents correctly** (descendants' `superDecks`, both parents' `subDecks`, cycle refusal with `[invalid_move]`); no new rename tool, and the existing error code stays `invalid_move`.
- No Postgres migration and no Dexie version.
- **Done when:** PGlite tests cover case rules, ambiguity, auto-create and its report, a path in each tool, and that the existing `update_deck` tests still pass.

### 4.2 Daily limits for MCP sessions, paused decks, boost, get_limits, set_limits

- **"Today" must mean the learner's today.** `logicalDayStart` uses the process's local zone (UTC on Vercel), so server-side counts would be shifted for anyone elsewhere. The app writes a synced setting `#timeZone` (an IANA name from `Intl.DateTimeFormat().resolvedOptions().timeZone`) **only when it is unset or when the learner changes it in a Settings picker with an `InfoTip`** (a user action), never on every launch, because two devices in different zones would otherwise overwrite each other; a pure `logicalDayStartIn(date, hour, timeZone)` in `src/logic/scheduling/` computes the day start for a given zone, and the server uses it. If `#timeZone` is missing the server falls back to UTC and says so in the output.
- **Counting new cards seen today (rule):** query `changes` for `tbl = 'reviewLogs' AND NOT deleted AND updated_at >= <day start in ms>` (a log row's `updated_at` is its `reviewedAt`), exclude `rating = 0` (manual rows), keep rows whose `state` before the answer was New (0), count **distinct card ids**, and map each card to its current deck. This is one query per session start. It is as fresh as each device's last sync, and the output says so.
- **Per-deck budget at session start:** the effective limit per deck is the preset's `newCardsPerDay` (for a deck with no preset, `effectiveOptions(deck).dailyNewCards`; an undefined limit means unlimited, as in `policy.ts`) plus today's boost, minus the count above. Because `pickNext` uses one counter (`new_served < new_limit`) and a parent-deck session spans sub-decks with different limits, the remaining budget per deck is computed **once at session start** and stored on the session as `new_budget jsonb` (deck id to remaining). Plumbing: `new_served` is written in `serve()` and in the session INSERT (`mcpStudy.ts`), so the jsonb is decremented in both places, and the field is added to `Sess` and `toSess`; `pickNext` takes the first New card whose deck still has budget above 0. It is not recounted later (MCP grading writes review logs immediately, which would double-count). **`new_limit`:** omitted means the sum of the budgets; supplied means `min(supplied, sum)`. A session's `limit` stays a cards-per-session cap. Migration: add `new_budget jsonb` to `mcp_study_sessions` (timestamp-named file, `ADD COLUMN IF NOT EXISTS`; 16.2 and Phase 23 add `tags` and `master_id` to the same table in their own files). **Apply the migration before deploying the code**, because the INSERT breaks without the column; every server test that loads an explicit migration list and touches study sessions gets the new files (for example `mcpStudy.test.ts`).
- **Paused decks:** MCP sessions currently ignore `priority: "paused"`. They must exclude paused decks like the app does: `isPausedDeck` walks the ancestor chain, and `withoutPaused` falls back to all cards when nothing active remains (`priority.ts`). The MCP filter does the same (`pickNext`, `emptyReason`, `get_due_cards`). A `deck_id` that is itself paused is allowed, as in the app (the learner asked for it). Tests cover an ancestor that is paused and the fallback.
- **`boost_new_today(deck, extra 1 to 500)`:** synced setting `#dailyBoosts` = `{ date: "YYYY-MM-DD" (logical date in the learner's zone), byDeck: { [deckId]: number } }`. A boost applies to **exactly that deck** (the app's limit is per `card.deck`; a parent boost does not propagate to sub-decks). A boost for another date is ignored and replaced on the next write. **Where it is applied in the app:** `effectiveOptions` is pure (it takes `(deck, presets)`, has no settings access and is shared with the server), so the boost and the Phase 22 catch-up override are added in `limitOf` in `CardScheduler.ts` only, which is where the app reads the daily limit. App UI: a deck menu item "Add extra new cards today" with an `InfoTip`.
- **Precedence** (same rule in `spec-targeted-review.md`): preset, then boost, then catch-up (Phase 22), which overrides both.
- **`get_limits(deck?)`:** per deck: effective new per day, reviews per day, boost, new seen today (as of last sync), remaining, exam date, the learner's time zone (or "UTC, not set"), and the catch-up state when Phase 22 exists.
- **`set_limits(deck, new_per_day?, reviews_per_day?, goal_date?)` (thin):** because every deck starts on the shared `default` preset, it **clones the preset automatically** (named after the deck) and re-points the deck when the preset is shared, then applies the same validators as `update_preset` (`newCardsPerDay`, `maxReviewsPerDay`, see `presets.ts`) and `update_deck` (`exam_date`, a local `YYYY-MM-DD`). It reports what it cloned. `edit_shared: true` edits the shared preset in place instead.
- **Done when:** tests for the day boundary in a non-UTC zone and across a DST change, the counting rule (manual rows excluded, distinct cards, deck mapping), boost date reset, per-deck budget across sub-decks, `new_limit` only lowering, paused decks excluded, clone-on-shared, and the app's `limitNewCards` honouring a boost.

### 4.3 Notes on tool responses, interval preview, error codes

- `Ctx` gains an **optional** `base` (the site origin); `tools/call` builds `{ db, userId, now }` today and `handleRpc` receives `base` only for `initialize`, so `tools/call` must pass it through, and tools degrade (no link) when it is absent (most tests call `handleRpc` without it).
- `start_study_session` and `next_card` return a short `note` chosen from four states (cards waiting, held by the daily limit, caught up, nothing to study); `end_session` adds the app link when `base` is known.
- **`show_answer` returns `comes_back_in_ms`** for ratings 1 to 4 from `scheduleCard()`. This needs a shared helper first: extract the inline `ScheduleContext` construction from `gradeCard` (`mcpWrite.ts`) into `scheduleContext(ctx, card)` that both `gradeCard` and `show_answer` call (decks, presets, settings, `resolveExam`, global FSRS, `cardOverride: card.fsrsOverride` and `newDayStartHour`). Test that `gradeCard` is unchanged.
- **Errors:** keep the `[code] message` convention of `StudyError`, `ManageError` and the evidence tools. Many other tools still throw plain `Error` (`mcpWrite.ts`, the rating check in `gradeCard`, the catch-all at the end of `tools/call`), so `structuredContent: { code }` covers only coded errors; convert the plain throws in the tools this phase touches. `structuredContent` exists only in protocol 2025-06-18 and the server negotiates down to older versions, so it is an **additive** field and a test covers each negotiated version. The old ADR 0022 vocabulary (expiring confirm tokens, per-client scoping) is dropped because confirm tokens are stateless.
- **Done when:** tests assert each `note` state, the four intervals (and that `gradeCard` still schedules identically), and `structuredContent.code` on a coded failure under each protocol version; the `tools/list` snapshot test is updated for any changed description.

### 4.4 `grading_mode`

- Values `silent` (grade without telling), `announce` (say the grade), `self_grade` (ask the learner to grade). A `start_study_session` argument, defaulting from the synced setting `#gradingMode` (added to `SettingsValues` and `defaultSettings`), returned in the session responses, and written into the session note text so the assistant follows it.
- App: a picker on the Settings, AI assistants tab with an `InfoTip`. It is a behaviour preference for the assistant, not an assessment framework (that is K/S, ADR 0012).
- **Done when:** the setting round-trips, the session reports the mode, and the three skill texts mention it (delivered to the live skill and verified with `get_skill`).

### 4.5 16.2: tag filter and history

- **`tags[]` on `start_study_session`:** up to 10 tags, AND match. Sessions persist only `deck_id`, so a migration adds `tags jsonb` to `mcp_study_sessions` (timestamp-named file, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, row security already on). The filter is applied in `pickNext` and `emptyReason`, not in the shared `snapshot` used by other tools. Phase 23 adds `master_id` to the same table in its own migration.
- **History retention 7 days to 90 days and 20 versions:** `HISTORY_DAYS` exists only in `src/server/noteHistory.ts` (the app has no constant, only the "7 days" copy in `NoteHistoryModal.tsx`). The server prune today deletes by age and keeps the just-inserted id; add a second `DELETE` that keeps the newest 20 versions per note, and keep the existing rule that the newest old version is never pruned. `card_history` (`mcpManage.ts`) returns `keeps_days` and gains a `keeps_versions` field. Update ADR 0011 (amended), the modal copy, the `card_history` and `restore_card_version` descriptions, and the free-tier storage estimate in `SPEC.md` (text only, a small cost).
- **Done when:** tests for the AND filter, the 10-tag cap, the empty-reason message, the prune rule at 20 versions and at 90 days, and that restore still works.

## 5. Deferred, with the reason written down

- **16.3 panel bridge.** `tools/list` builds only `readOnlyHint` and `destructiveHint`; `annotations: { audience: ["app"] }` is not an MCP tool annotation; `initialize` advertises no `extensions` capability; `resources/list` serves skills only; the stateless POST route cannot remember which client supports UI; no UI bundle or `ui://` resource is specified; all seven panel tools would only wrap existing study tools. Redo it against the real MCP Apps contract if a client the owner uses supports it.
- **`panel_reminders` and `#reminderConfig`:** nothing can fire a reminder without a cron or push, which the project forbids.
- **`server_state` and `/api/mcp-media`:** media URLs can be signed with the existing `hmac()` and R2 presigning; no table.
- **`basic_typed`, speech blocks, HTML fields:** each changes the app (types, editors, study screens), and speech blocks would be lost on any app edit because `updateNoteContent` writes content wholesale. Specify them separately if wanted.
- **`list_decks` goal data and the 11.4 pacing algorithm:** conflicts with the existing exam-date logic; pick one model first.
- **Cut:** `archive_deck`, `unarchive_deck`, renaming the `reverse` type (it would break the seeded skills and existing clients), the 1 MiB MCP body limit (conflicts with image uploads), connector-scoped confirm tokens, per-call telemetry.

## 6. Build order and tests

1. `mcpDecks.ts`: `resolveDeckPath` and path support in the tools that take a deck.
2. Time zone setting and `logicalDayStartIn`; paused decks in MCP sessions; server-side daily limits with the per-deck budget (migration); `boost_new_today` (app and server); `get_limits`; `set_limits`.
3. `Ctx.base`, the shared `scheduleContext` helper, notes on responses, `comes_back_in_ms`, `structuredContent.code`, `grading_mode`.
4. 16.2: `tags[]` migration and filter; history retention.
After each: `pnpm exec biome check --write`, `pnpm lint:type`, `pnpm test`; `pnpm build` for any step touching routes or config; a browser check for the app UI pieces (boost menu item, grading picker). Update HANDOFF, SPEC, `docs/features.md`, `docs/gotchas.md` and the skills (delivered to the live skill) with each step. **ADR:** record the server-side daily limits with the `#timeZone` rule, and the additive `structuredContent`, as ADR 0018 (proposed, `docs/adr/0018-mcp-daily-limits-and-time-zone.md`).

## 7. Calls I made

1. Cut `rename_deck` and archive (`update_deck` and `paused` exist). 2. Daily limits and paused decks for MCP sessions are new behaviour, counted from synced review logs in the learner's time zone (as of last sync), with the budget fixed at session start. 3. `set_limits` clones the shared preset automatically. 4. Keep the `[code]` error convention and add `structuredContent` additively. 5. 16.3, `basic_typed`, speech, HTML and goal data are deferred. 6. A boost applies to the exact deck. 7. New deck helpers live in `mcpDecks.ts`.
