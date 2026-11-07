# Skola Fork: Spec and Phased Plan

Source: the Notion plan "Flashcards App — Skola Fork Plan". This file records the current design and what is built. Status key: DONE, IN PROGRESS, TODO.

## 1. Goal

A free, cloud-hosted, local-first spaced-repetition app for phone and desktop: FSRS-6, Anki-level features, image occlusion, an MCP server for AI assistants, and AI skills for deck maintenance.

## 2. Requirements

- F1. Flashcards scheduled with FSRS-6 (`ts-fsrs`).
- F2. Works offline as an installable PWA; devices sync through a server.
- F3. Free tiers only (Vercel Hobby, Supabase Free, Cloudflare R2 for media).
- F4. Email + password accounts, password reset by emailed OTP, OAuth-style tokens bound to an audience.
- F5. MCP server so Claude can read decks, add cards and quiz the user.
- F6. Image occlusion and other media (R2 only for these).
- F7. Anki-level features, exam/goal dates, AI skills (see phases).
- N1. Review history is never lost: append-only log, scheduling state recomputable.
- N2. Every server row is scoped to one user.
- N3. Few API calls, to stay inside free-tier limits. No cron job, polling or background worker.
- N4. License: Skola is AGPL-3.0; a publicly run modified version must publish its source. MIT code (Openlet, spacedrep) may be copied; Occlude has no license (ideas only).

## 3. Stack

| Area | Choice |
|---|---|
| App | Next.js 16 (webpack), React 19, TypeScript; the Skola UI runs client-only (`ssr: false`, hash router) |
| PWA | Serwist service worker; shell precached, `/api`, `/oauth`, auth pages and `/.well-known` are network-only |
| Local DB | Dexie (IndexedDB), schema v26 |
| Scheduler | `ts-fsrs` 5.x (FSRS-6). v6 deprecates the `repeat()` API and defaults to FSRS-7 |
| Server | Next.js route handlers on Vercel (Hobby) |
| Database | Supabase Postgres (Free), project `skola`, region `ap-south-1`, accessed through `pg` and the Transaction pooler (port 6543) |
| Auth | Auth.js (email + password, login cookie) plus our own OAuth 2.1 server (opaque, audience-bound tokens) |
| Email | Resend (REST) for reset codes |
| Media | Cloudflare R2, image occlusion and other media only, presigned uploads from the browser (TODO) |
| Tests | Vitest, `fake-indexeddb`, PGlite (in-memory Postgres) |

Repo: the fork `DHEERAJKUMAR24/skola`, branch `next-migration`. Code lives in `app/`; this file is `app/docs/SPEC.md`. Current status: `HANDOFF.md`. Decisions: `adr/`.

## 4. Architecture

```
Browser / PWA                         Vercel (Next.js)                 Supabase
Dexie (IndexedDB)  -- bearer token --> /api/sync/push, /api/sync/pull --> Postgres
service worker     -- OAuth + PKCE --> /oauth/*, /login, /api/account/* --> (users, tokens, changes)
                                       later: /mcp                        R2 (media, later)
```

## 5. Data

Client (Dexie v26): `cards`, `decks`, `notes`, `settings`, `presets` (synced; rows get `updatedAt` from Dexie hooks, `src/logic/syncTracking.ts`), `reviewLogs` (append-only), `tombstones` (deletions), `statistics` (local only). Study presets live in `presets` (see fsrs-and-presets.md).

Server (`app/supabase/migrations/20261101000000_init.sql`): `changes` (per-user rows with `seq`), `users`, `password_resets`, `oauth_clients`, `oauth_codes`, `oauth_tokens`. Row-level security is enabled on all of them so Supabase's public anon key cannot read them; the server connects as the table owner.

## 6. Design

### 6.1 Sync
- `POST /api/sync/push` takes `{rows:[{tbl,id,data,updatedAt,deleted?}]}` and applies a row only if strictly newer than the stored one. Allowed tables: decks, cards, notes, reviewLogs, settings, presets, studySessions (review logs are append-only and pushed by `reviewedAt`; see the ADR 0008 update). A per-user advisory lock keeps `seq` order equal to commit order.
- `GET /api/sync/pull?since=N` returns up to 500 rows with `seq > N`.
- Client (`src/logic/sync.ts`): pushes rows changed since the last push; pulls and applies with `syncFlags.applyingRemote` set so pulled rows are not re-stamped. A pulled row never overwrites an equal or newer local row. A malformed pulled row is skipped instead of blocking sync. Dates travel as `{ $d: ms }`.
- Request budget: pull on start, sign-in and reconnect; push 5 s after a local edit (push only); pull on focus at most once a minute and every 10 minutes while the tab is visible; keepalive push when the page hides. Idle or hidden tabs make no requests. A test with a fake clock covers this.
- Conflicts: different rows both kept; same row newest `updatedAt` wins; reviews are append-only. Limit: device clocks decide `updatedAt`; move to server sequence or a hybrid logical clock if skew matters.

### 6.2 Auth
- Login: Auth.js Credentials, email + password only, no passkeys. scrypt hashing; 5 failed attempts lock the account for 15 minutes. The Auth.js JWT cookie is used only by `/oauth/authorize`, and the user must still exist in the database.
- Forgot password: emailed 6-digit OTP (HMAC-hashed, 10 minute expiry, 5 tries, one email per minute, same response whether or not the account exists). A reset revokes all of the user's tokens.
- Tokens: our own OAuth 2.1 server (Auth.js cannot issue tokens). Authorization code with mandatory PKCE (S256); opaque random tokens stored as SHA-256 hashes; access 1 hour; refresh 30 days with rotation; replaying an old refresh token revokes the grant.
- Audience: each token is bound to one resource via RFC 8707 `resource`: `<APP_URL>/api` (scope `sync`) or `<APP_URL>/mcp` (scope `mcp`). A token only validates for its own audience.
- Clients: the PWA is the first-party public client `skola-web` (no consent). Others (claude.ai) register through dynamic client registration (RFC 7591), must send `resource`, and see a consent page.
- Endpoints: `/oauth/authorize|token|register|revoke`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/mcp]`, `/api/me`, `/api/account/signup|forgot|reset`. Pages: `/login`, `/signup`, `/forgot-password`, `/oauth/callback`, `/oauth/consent`.
- Sign-up is open by default; `ALLOW_SIGNUP=false` allows only the first account.
- Limits: tokens in `localStorage` (marked `shortcut:`); no per-IP rate limiting; no email verification at sign-up; no introspection endpoint (MCP will validate in-process).

## 6.4 Scheduling policy and organizing

- **FSRS stays untouched.** `scheduleCard` (`src/logic/scheduling/policy.ts`) runs ts-fsrs and then only adjusts `due` (whole-day alignment, exam cap) and `scheduled_days` (maximum-interval cap). Stability, difficulty, reps and lapses are exactly what FSRS computed.
- **Hierarchy.** Domain, subject and concept are nested decks (`superDecks` lists the ancestors). Cards belong to a note and a note to a deck. Moving a note changes only its deck: card ids, FSRS models and review logs stay the same (covered by tests and checked in the app).
- **Settings resolution.** card override, then the card's deck, then the global settings. The exam date comes from the deck or its nearest ancestor.
- **Sample data.** Settings > Database > "Load JavaScript interview sample" builds Programming Languages > JavaScript (exam in 3 weeks) > 7 concepts with 42 cards, tags and simulated history. One concept uses whole-day timing to show decks can differ.

## 7. Phases

| Phase | Status | Notes |
|---|---|---|
| 0 Setup | DONE | Fork created, Dexie Cloud and gh-pages removed, Next.js migration pushed (`next-migration`) |
| 1 FSRS core | DONE | ts-fsrs (FSRS-6), append-only reviewLogs. Study presets (Anki-style option groups, synced): daily new/review limits, new-card order, learning/relearning steps, desired retention, max interval, fuzz, exact-time or whole-day scheduling, easy days, leech threshold + action, sibling burying, personal FSRS weights, in-browser optimizer (fsrs-browser WASM worker) and workload simulator. Per-deck preset picker + exam date; sub-decks inherit; older decks keep inline options. Not verified in a browser: optimizer on real history |
| 2 Auth | DONE | Section 6.2, verified in a browser against Supabase. Needs production env vars and a Resend domain |
| 3 Sync | CORE DONE | Section 6.1. Settings and presets now sync. Review logs and study sessions sync too (pushed by time). Open: a "Synced / N waiting / Offline" indicator, offline two-device conflict test, tombstone gap (a delete is lost if the tab closes in the instant after it), per-field merge |
| 4 Media (R2) | DONE in code, needs your bucket | Pictures (image occlusion and pictures in rich-text cards) are shrunk to WebP in the browser, saved on the device, and uploaded straight to a private R2 bucket with short-lived presigned links (`src/server/r2.ts`, `media.ts`, `app/api/media/*`; key `u/<user>/<sha256>`, so identical pictures are stored once). Notes keep `media:<sha256>`; reads go through `GET /api/media/url`, which checks the picture belongs to the signed-in user; a second device downloads it once, verifies the fingerprint and keeps it for offline use. 200 MB quota per account, 15 MB per picture, size re-checked with a HEAD request after the upload. Without R2 settings (or signed out or offline) pictures stay inside the note as before, and are moved out later. Over MCP, pictures sent as bytes are stored in R2 and read back as a link valid for an hour; `image_url` is kept as a plain link and never downloaded. Signer checked against Amazon's published example; whole flow (CORS preflight, signed PUT, confirm, signed GET on a fresh device) run in a browser against a fake R2 that verifies signatures. Not run against real R2. Open: orphaned objects are never deleted (no cleanup job), no per-picture sharing between accounts |
| 5 MCP | DONE | `/mcp` (Streamable HTTP, stateless JSON; `src/server/mcp*.ts`, `app/mcp/route.ts`) validates `aud = <APP_URL>/mcp` and scope `mcp`. Read tools: list_decks, deck_stats, get_due_cards, search_cards, find_leeches, find_duplicates, find_similar_cards (similar wording, no AI, `src/logic/duplicates/similarity.ts`). Write tools: create_deck, add_cards (basic, reverse, cloze, multiple choice, list, image occlusion), edit_card (text, tags, suspend, every type), grade_card (same `scheduleCard` policy as the app, review log, leech and sibling rules). Writes go into the synced `changes` rows, so devices receive them on the next pull. Tools carry `readOnlyHint` annotations. Verified end to end with a real OAuth login, consent and token flow against a local server. Open: Claude Desktop via `npx mcp-remote` and a real client run against the deployed server not tried; no read-only scope. Reverse (double-sided) notes can be created over MCP like the app does (type `reverse`: front, back; two cards). Image occlusion and the other types can be added and edited. Agent skills over MCP, stored in Postgres (`skill_files`, `skill_history`; migration 20261102): default skill shared by everyone, edited live by admins (`SKILL_ADMINS`) at `/#/settings/skills` (`/skills/edit` redirects there) or over MCP; each user can create, update, delete, copy-and-customise and restore their own skills over MCP (tools get_skill, create_skill, update_skill_file, delete_skill_file, delete_skill, skill_history, restore_skill_file), and a user skill replaces a default of the same name for that user only. Also served as MCP resources (`skill://`) and prompts, `/llms.txt` (about the product), `/llms-skill.txt` (the skills, full text; the two link to each other), raw files and zip under `/skills/<name>/`, and a human page at `/skills`. |
| 6 Full FSRS | MOSTLY DONE | Done: presets, per-deck and per-card options, exact-time or whole-day scheduling, strict max-interval cap, daily new and review limits, easy days, leech and sibling rules, manual due date and reset (logged as Manual), optimizer, simulator. Open: load balancing, reschedule from history, optimizer verification |
| 7 Exam dates | DONE | Date set on any deck and inherited by sub-decks; due dates are pulled back so every card is seen again before the exam (buffer days); desired retention ramps up over the last 45 days; only `due` is adjusted, never stability or difficulty; deck page shows countdown, expected score, learned, not started, at-risk and a daily new-card pace; Cram mode reviews everything once without changing FSRS state or the log |
| 8 Anki features | PARTIAL | Done: tags on notes (indexed, normalized), tag filter and search in the explorer, tag editor on the opened note, bulk move and bulk add or remove tags for the selection, deck paths shown in deck pickers, suspend and bury, guided tours and tooltips. Card types done: basic, reverse (double-sided), cloze (one card per deletion; new deletions added while editing get a card), multiple choice (several correct answers allowed, stable shuffle, explanation), list recall (`>>>`, dash or bullet lines), and image occlusion (picture shrunk in the browser to WebP and stored in the note, drawn areas, one card per area, hide-all or hide-one). Open: note templates, filtered decks, undo, Web Push, `.apkg` import and export; image occlusion pictures live inside the synced note (about 400 KB cap) until R2 media storage exists |
| 9 AI skills | DONE (5 default skills; no workflow engine by decision, ADR 0015) | `skola` (core, routes to the others) plus `skola-active-learning-tutor`, `skola-card-architect`, `skola-deck-maintainer`, `skola-quality-auditor` (`src/server/skillSeed.ts`, `skillSeedLearning.ts`). Editable in the app at `/#/settings/skills`. Built-in skills are topped up into a used table without overwriting edits |
| 10 MCP study and management | DONE in code (0.6.0, migrations applied live, not tested with a real client) | Study sessions with show_answer and idempotent submit_review (ADR 0013); deck and card management parity: get_deck, update_deck, delete_deck, list_presets, update_preset, list_cards, list_tags, get_card_details, deck_schedule, set_card_schedule, move_cards, delete_cards, bulk_update_cards (deletes use a confirm token); `get_capabilities`, image occlusion tools. Open: semantic duplicates |
| 11 Edit history | DONE (MCP and app) | Previous version of a note kept 7 days, no cron, never empty for an old note (ADR 0011); `card_history`, `restore_card_version`. App: History in the note and card menus (diff, restore), `/api/history`; needs sign-in. Not checked in a browser yet |
| 12 K/S evidence | DONE (MCP and app) | Objectives, assessments, mastery rules (ADR 0012); server-only tables. App: `/objectives` page (list, detail, assessment history, linked cards, create, edit, delete, manual assessment), `/api/objectives`. Not checked in a browser yet. Open: sync to devices |
| 13 Profile instructions | DONE | Synced `#aiInstructions` with a built-in default, Settings, AI assistants tab, `get_instructions` and `set_instructions` (ADR 0013) |
| 14 Settings sidebar and in-app skills | DONE | Second sidebar, in-app Connect and Skills editor, `/skills/llm.txt` for agents. Skill editor not tested signed in |
| 15 Master card | CORE DONE in app, MCP tools and skills DONE 2026-11-06 (ADR 0014) | Hierarchy setting and page, pure coverage engine, `master` note type with editor, study view with suggested rating, notes explorer view, deck menu "Create Master Card", card picker. MCP: create_master_card, get_master_card (repurposed name), list_master_cards, update_master_card, master_coverage, suggest_master_rating, delete_master_card (`src/server/mcpMaster.ts`), study sessions and card tools know the type, skills updated (architect, maintainer, tutor, auditor). App UI 2026-11-06: builder page `/master/:noteId`, graph `/graph`, activities (recall sweep, gap hunt, weak-spot drill), deck Masters tab. Not checked in a browser |
| 16.1 Deck ergonomics and pacing (MCP) | DESIGN, corrected 2026-11-07 (docs/spec-phase-16.md), recommended: build | Deck paths (`A::B`), rename and re-parent, daily limits applied to MCP sessions, `boost_new_today`, `get_limits`, `set_limits`, notes on tool responses, `comes_back_in_ms`, `structuredContent.code`, `grading_mode`. No deck migration (decks are JSON rows); archive is cut (paused exists) |
| 16.2 Study and note enhancements | DESIGN, corrected 2026-11-07 (docs/spec-phase-16.md), recommended: build smaller | `tags[]` filter for study sessions (one migration), history 90 days / 20 versions. `basic_typed`, speech blocks and HTML fields deferred |
| 16.3 MCP UI panel bridge | DEFERRED 2026-11-07 (docs/spec-phase-16.md section 5) | No MCP-UI contract exists in the code; reminders would need a cron |
| 17 Import and export | DESIGN, corrected 2026-11-07 (docs/spec-phases-17-20.md), recommended: CSV in the browser now, `.apkg` import later, `.apkg` export cut | One round-trippable CSV format, preview before writing, formula-injection prefix; no review history exported |
| 18 Security hardening | DESIGN, corrected 2026-11-07 (docs/spec-phases-17-20.md), recommended: reduced | Refresh-token grace window and purge (rotation and replay already exist); magic-byte check on upload confirm; passkeys deferred |
| 19 Multi-user invite | DEFERRED 2026-11-07 (docs/spec-phases-17-20.md section 6) | No stated user problem |
| 20 Stats dashboard | DESIGN, corrected 2026-11-07 (docs/spec-phases-17-20.md section 3), recommended: build | Replaces the placeholder `StatsView` at the existing `/stats` route; streak, retention, heatmap, forecast from local data; CSS and SVG, offline |
| 22 Targeted review and card fusion | DESIGN, waiting for approval 2026-11-07 (docs/spec-targeted-review.md) | Run counter on each card (3 right in a row = ready to upgrade, 3 wrong = stuck); targeted review page: go deeper or delete stuck cards, fuse 2-3 ready cards into one higher-order question (AI drafts, learner approves), originals stay in study, linked; filter before a card is made; weekly budget and catch-up mode. No server tables, no cron |
| 23 Master card: concept sheet, session, relations, what-if | DESIGN, waiting for approval 2026-11-07 (docs/spec-master-card.md, ADR 0016 proposed; research in docs/research-master-card-visual-revision.md) | The master is a lens over the learner's cards: a sheet (diagram, key points, examples, pitfalls, tips, related concepts) that is read-only; many cards of any type per entry; a session through `/learn` on the real cards in diagram order; opt-in relation cards (cards of the master note); a what-if test computed from the arrows; gaps with fixes; readiness (Recall, Explain, Predict, Apply; untested is not zero); concept group and related masters; flow diagram with @xyflow/react + @dagrejs/dagre (lazy). Originals stay in study. No self-marked quiz, no cron; one small migration for the MCP session (`mcp_study_sessions.master_id`) |
| 24 Ask AI (copy a prompt, open your assistant) | DESIGN, waiting for approval 2026-11-07 (docs/spec-ask-ai.md) | One button and one prompt builder for every AI-needing feature: copies a short prompt (ids and names only) and opens the user's assistant, which works through MCP; user-editable assistant list (`#aiTargets`) with research-based defaults; rule: human UI, MCP and Ask AI must all exist for an AI feature. No AI key, no server tables |

## 8. Accounts and keys

| Need | Where | Status |
|---|---|---|
| GitHub fork | github.com | done |
| Supabase project + `DATABASE_URL` | supabase.com, Project, Connect, Transaction pooler | done (in `app/.env.local`) |
| `AUTH_SECRET` (random, 32+ chars) | `openssl rand -base64 32` | local dev value only; generate a new one for Vercel |
| `APP_URL` | your Vercel URL | set on Vercel |
| Vercel project | vercel.com | TODO |
| `RESEND_API_KEY` + verified domain for `EMAIL_FROM` | resend.com | TODO (needed for reset emails in production) |
| R2 bucket + API token | Cloudflare dashboard | TODO (Phase 4; asks for a card, billed past the free allowance) |

Never paste secrets into chat; keep them in git-ignored `.env.local` and in Vercel environment variables.

## 9. Operations

- Local: `.env.local` from `.env.example`, then `pnpm dev`. Schema changes go in `app/supabase/migrations/`, applied with the Supabase CLI (`supabase link`, then `pnpm db:push`). Tests: `pnpm test`; types: `pnpm lint:type`.
- Supabase Free projects pause after about a week without activity; resume from the dashboard. Confirm the plan under Billing.
- Vercel Hobby is for non-commercial use. Consider setting the function region to `bom1` to sit next to the database.
- The old Cloudflare Worker and D1 database, and the local `worker/` folder, were deleted.

## 10. Risks and known gaps

- v0.6.0 (`f382572`) is pushed to `main`; the Vercel build status was not confirmed. The Resend domain and real R2 are untested.
- Edit history and K/S evidence have app UI now (phases 11 and 12); neither is tested with a real MCP client.
- `pnpm lint` (Biome) reports 18 warnings and no errors (17 are upstream a11y warnings).
- AGPL obligations if hosted publicly with changes.
- Free-tier limits quoted here are from memory; verify them before relying on them.

## 11. Next steps (see HANDOFF.md for the live list)

1. Confirm the production deploy of `main` is Ready and smoke test sign-in, sync and `/mcp`.
2. Test with a real MCP client; re-paste the default `skola` skill row.
3. Owner approves or changes Phases 22 to 24 (docs/README.md lists the designs); then plan and build in the order recommended in section 12.
4. Resend domain, real R2, Phase 3 hardening.

## 12. Recommended build order (not a decision: the owner approves the designs first)

All Phase 16 to 24 documents were reviewed against the code on 2026-11-07; `docs/README.md` lists them. Dependencies found in review:
- Phase 22 reports remaining-today numbers through `get_limits` (Phase 16.1) but does not need it to start; precedence of limits is preset, then boost (16.1), then catch-up (22).
- Phase 23 steps 1 to 3 need nothing else; its Gaps "stuck" check needs the Phase 22 run counter; its Ask AI column needs Phase 24.
- Phase 24's button and prompt builder come first, with no actions; actions are added with the features that use them.
- Phases 22 and 23 both edit `skillSeedLearning.ts`; deliver skill text to the live database after each (ADR 0006).

Order: 1. Phase 16.1. 2. Phase 24 core (button, builder, `#aiTargets`). 3. Phase 22 steps 1 to 2 (run counter and lists; check real-data yield first). 4. Phase 23 steps 1 to 3 (many cards per entry, session, sheet). 5. Phase 22 fusion and catch-up, then Phase 23 steps 4 to 8, each adding its Ask AI actions. 6. Phase 20, then Phase 17 (CSV), then 16.2. 7. Phases 16.3, 17 (`.apkg`), 18 and 19 only on demand.
