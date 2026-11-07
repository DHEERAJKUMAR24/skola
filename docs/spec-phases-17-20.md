# Phases 17 to 20: import and export, security, invites, stats (corrected design)

- **Status:** DESIGN, rewritten on 2026-11-07 after an independent code review showed the old Phase 17 to 20 text was wrong about Skola's code in several places. Waiting for the owner's approval. Nothing is built.
- **Supersedes:** the Phase 17, 18 and 19 parts of `spec-comparison-flash-deep.md` (section 7) and its sections 11.9 to 11.14 and 11.16 to 11.22, wherever they differ from this file.
- **Phases:** 17, 18, 19, 20 in `docs/SPEC.md`.

## 1. Facts the old text got wrong (verified in the code)

| Old assumption | Reality |
|---|---|
| 18.2 adds rotating refresh tokens with replay detection and a `revoked_at timestamptz` column | `src/server/oauth.ts` already rotates refresh tokens, keeps `prev_refresh_hash` and sets `revoked_at` (a `bigint`) on replay (init migration `oauth_tokens`; ADR 0005 says so). What is missing is a grace window (a lost response then a retry signs the client out), only one previous hash is kept, and dead rows are never purged |
| 18.3 re-keys media as `media/{userId}/{sha}.{ext}` with a new `media_assets` table | `src/server/media.ts` already keys objects `u/<user>/<sha256>`, deduplicates, and has the table `media_objects` (`20261103000000_media.sql`). The real gap: `confirmUpload` checks size only and trusts the client's hash and type; magic bytes are checked only in `storeBytes` |
| Phase 20 is a new `/#/stats` page in `src/logic/stats.ts` | A route `/stats/:deckId?` already exists (`ClientRoot.tsx`) rendering a placeholder `StatsView.tsx`; `src/logic/statistics.ts` already holds `studySessions` and `totalsByDay` |
| Review log has `phase_before`, `answer_ms`, `source`; cards have `state`, `due` | `ReviewLogRecord` is ts-fsrs `ReviewLog` plus `id`, `card`, `reviewedAt`; the state before the answer is `state` (0 New, 1 Learning, 2 Review, 3 Relearning). Cards hold `model.state`, `model.due`, `model.scheduled_days`. The cards index is `id, note, deck, updatedAt`, so due queries scan. The day start setting is `#newDayStartHour` with `logicalDayStart` |
| Phase 17 uses Drizzle, jszip, sql.js, a 100 MB Vercel upload, a 2-hour disk park | None of these exist. The server stores no cards or review tables, only `changes` rows; Vercel request bodies are about 4.5 MB and there is no persistent disk. Import must run in the browser |
| 17 maps Flash note type names | Skola's enum is `normal`, `cloze`, `imageOcclusion`, `multipleChoice`, `list`, `master`, `doubleSided` |

## 2. Scope (recommended; the owner can change it)

| Phase | Verdict | Why |
|---|---|---|
| 17 CSV import and export, in the browser | **Build** | About a day; no server code; useful for moving small sets |
| 17 `.apkg` import | **Defer** (browser-only design below) | The one real adoption feature, but heavy and needs a decision on supported Anki versions |
| 17 `.apkg` export, revlog export and replay | **Cut** | Skola's review rows cannot map to Anki's revlog; export has no user problem |
| 18.2 refresh tokens | **Build smaller** (grace window, purge) | Real MCP-client sign-out risk; no migration |
| 18.3 media | **Build smaller** (magic-byte check on upload confirm) | Closes a real hole; no re-key, no new table |
| 18.1 passkeys | **Defer** | One-owner app with password lockout; new tables, challenge storage and an `rpID` lockout risk |
| 19 multi-user invite | **Defer** | No stated user problem; sign-up is open by default, so a second user needs nothing (or remove `ALLOW_SIGNUP=false` for a day) |
| 20 stats | **Build** | Highest value, lowest cost, all client-side |

## 3. Phase 20: the stats page (build)

- Replace the placeholder `src/app/statistics/StatsView.tsx` at the existing route `/stats/:deckId?` (deck filter from the route). No new route, no chart library: CSS grid and SVG.
- **Data (all local, works offline):** `db.reviewLogs` (`reviewedAt`, `rating`, `state` before the answer) and `db.cards` (`model.state`, `model.due`, `model.scheduled_days`, `suspended`). Day boundaries use `#newDayStartHour` and `logicalDayStart` (the browser's own zone, which is right on the client). **Streak, heatmap and retention come from `reviewLogs` only:** `studySessions.day` is set with `toISOString()` (UTC), so it cannot be bucketed by the logical day; `studySessions` is used for time spent only.
- **Manual rows are excluded everywhere:** `setDueDate` and `resetCard` (`cardControls.ts`) and the MCP `set_card_schedule` write `Rating.Manual` (0) rows whose `state` is the card's current state; every measure filters `rating !== Rating.Manual`, as `useTodayActivity.ts` does.
- **Definitions:**
  - *Streak:* consecutive logical days with at least one review; today counts if it has a review, otherwise the streak continues from yesterday. *Longest streak:* the maximum over the loaded range.
  - *Retention:* share of reviews with rating Hard, Good or Easy among reviews whose state before the answer was Review, over a selectable window (30, 90 or 365 days; default 30). Shown with the count it is based on; hidden under 20 reviews.
  - *Heatmap:* the last 53 weeks, one cell per logical day; intensity 0 for no reviews, and 1 to 4 by quartile of the non-zero days in the shown range.
  - *Forecast:* due cards for each of the next 7 logical days from a scan of `db.cards` (unsuspended, not New), plus a count overdue now.
  - *Mature:* `model.scheduled_days >= 21`.
- InfoTips on each measure; a tour entry for the page.
- **Done when:** fake-indexeddb fixtures prove the streak (including the "today empty" case and manual rows being ignored), retention over each window, heatmap buckets and forecast; the page renders with no network; `pnpm build` passes; a browser check. Reuse `forecast.ts` and `summary.ts` if they already compute part of this (the build checks first).

## 4. Phase 17: CSV in the browser (build)

- **Format (one, round-trippable):** UTF-8, RFC 4180 quoting, header `front,back,tags,deck` (extra columns ignored). Tags separated by `;`. `deck` is a `Parent::Child` path (created if missing; empty means the chosen deck). Basic cards only.
- **Import:** a settings page "Import and export" (InfoTip, tour entry). Parse in the browser, show a preview (rows, new decks, skipped rows with reasons, exact duplicates of front and back in the same deck, which are skipped), then write per row with `newNote(deck, content, tags)` followed by `newCard` (not the type adapter, whose basic `createNote` takes only `{front, back}` and would drop the tags; `newNote` creates no card by itself and mutates `deck.notes`, so one `deck` object is reused for the whole batch), in Dexie transactions of 500 rows. Limits: 10,000 rows, 5 MB. Plain text only: cells are escaped and line breaks become paragraphs (the same as MCP `add_cards`). A leading `'` is removed only when the next character is `=`, `+`, `-`, `@`, a tab or a carriage return (exactly the characters export prefixes).
- **Export:** the same four columns for the chosen deck (and sub-decks). Notes store TipTap HTML, so export turns `</p>` into a newline and strips the tags, and non-basic notes are skipped and listed in a report. Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'` (spreadsheet formula injection), and so does a cell that already starts with `'` followed by one of those characters (so import, which strips exactly one `'`, restores it). No review history is exported.
- Deck names containing `::` are rejected (Phase 16 rule). **Done when:** tests prove a round trip (including cells starting with each prefixed character), quotes and newlines, the injection prefix both ways, the row limit, duplicate skipping, deck path creation, and that nothing is written until the learner confirms the preview.
- **Deferred `.apkg` import (browser-only design, for later):** lazy-loaded `sql.js` and a zip reader; support exports made with "Support older Anki versions" (`collection.anki2`), because newer packages use a compressed `collection.anki21b` that needs a zstd decoder; all cards start New (no review replay and no scheduling import); map Basic, Basic (and reversed) and Cloze to `normal`, `doubleSided` and `cloze`, skip other types with a report; media through the existing `saveMedia` and `uploadPending`; show counts before writing. Specify it fully before building.

## 5. Phase 18 (reduced)

**18.2 refresh tokens (build smaller, no migration).** Keep the existing rotation and replay revocation. Add:
- a **grace window** (the previous token is accepted as a retry for a short time; the builder picks the value, 5 minutes in the old text, and records it). The rotation time is already known: it is `refresh_expires_at - REFRESH_TTL_MS` (`oauth.ts`), so no new column. On a grace hit, issue a fresh pair and set `prev_refresh_hash` to the **current** hash (not the presented one), otherwise each retry would reset the clock and the window would never close. Outside the window, replay revokes the grant as today;
- keep one previous hash unless the builder shows a real case that needs more;
- **purge** lazily on the token endpoint (no cron): delete rows with `revoked_at` set, or `refresh_expires_at < now`. An expired access token alone is not a reason to purge.
Revoking is one grant (as in the code), not "all sessions". **Done when:** PGlite tests for a retry inside the window, a replay outside it, the clock not resetting on retries, purge, and that a normal refresh still rotates.

**18.3 media (build smaller).** After `confirmUpload` accepts the object, fetch its first bytes with a Range request and check the magic bytes with the existing `sniffImage`; refuse and delete the object if it is not an allowed image, and check the declared type matches. No re-keying, no new table. `storeBytes` already sniffs, so that path checks twice (harmless). `confirmUpload` selects only `size` today, so it also selects `type` to compare the declared type. `media.test.ts` mocks `r2Deps.fetch` and returns an empty body for every call that is not PUT or DELETE, so **every existing confirm test fails until the mock returns the object's bytes for a Range GET**; the build updates the mock first. **Done when:** tests with a real PNG, a renamed text file, and a mismatched type. Orphan cleanup stays a later, user-triggered job (ADR 0007).

**18.1 passkeys (deferred).** Needs two new tables (credentials, challenges), a second `authorize` path in an Auth.js Credentials-only setup, `rpID` and origin from `APP_URL` (a wrong value locks everyone out), and clone detection. Not worth it for one owner with password lockout.

## 6. Phase 19 (deferred)

No invite flow now. Sign-up is open by default; `ALLOW_SIGNUP=false` closes it only when a user already exists (`users.ts`). If a second user is ever needed, remove `ALLOW_SIGNUP=false` for a day, or insert the row by SQL. In the closed mode the "first account only" check is a count followed by an insert and is not atomic; fix that before relying on it. A migration for an invites table would follow the repo convention: timestamp-named file, `CREATE TABLE IF NOT EXISTS`, row security enabled, `text` ids, `bigint` millisecond timestamps.

## 7. Build order

1. Phase 20 (stats). 2. Phase 17 CSV. 3. Phase 18.3 and 18.2 if wanted. The rest only on demand. After each: `pnpm exec biome check --write`, `pnpm lint:type`, `pnpm test`, `pnpm build`, a browser check; docs updated (SPEC, HANDOFF, `features.md`, `gotchas.md`). **ADR:** the refresh-token grace window is a security decision: record it as an amendment to ADR 0005 when built.

## 8. Calls I made

1. Stats: CSS and SVG, no chart library; 30-day default window. 2. CSV only, in the browser, one format. 3. No review history in any export. 4. Phase 18 reduced to what the code really lacks. 5. Passkeys and invites deferred.
