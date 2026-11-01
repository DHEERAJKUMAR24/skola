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
- N3. Few API calls, to stay inside free-tier limits.
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
- `POST /api/sync/push` takes `{rows:[{tbl,id,data,updatedAt,deleted?}]}` and applies a row only if strictly newer than the stored one. Allowed tables: decks, cards, notes, settings, presets (reviewLogs are local; see ADR 0008). A per-user advisory lock keeps `seq` order equal to commit order.
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
| 3 Sync | CORE DONE | Section 6.1. Settings and presets now sync. Open: statistics and review-log sync, a "Synced / N waiting / Offline" indicator, offline two-device conflict test, tombstone gap (a delete is lost if the tab closes in the instant after it), per-field merge |
| 4 Media (R2) | TODO | Presigned upload URLs, cards store a media key, auth-checked access, offline cache, WebP resize, SHA-256 dedupe. Needs an R2 bucket and token |
| 5 MCP | TODO | `/mcp` route validating `aud = <APP_URL>/mcp`; tools list_decks, create_deck, add_cards, edit_card, search_cards, get_due_cards, grade_card, find_duplicates, find_leeches, deck_stats |
| 6 Full FSRS | MOSTLY DONE | Done: presets, per-deck and per-card options, exact-time or whole-day scheduling, strict max-interval cap, daily new and review limits, easy days, leech and sibling rules, manual due date and reset (logged as Manual), optimizer, simulator. Open: load balancing, reschedule from history, optimizer verification |
| 7 Exam dates | DONE | Date set on any deck and inherited by sub-decks; due dates are pulled back so every card is seen again before the exam (buffer days); desired retention ramps up over the last 45 days; only `due` is adjusted, never stability or difficulty; deck page shows countdown, expected score, learned, not started, at-risk and a daily new-card pace; Cram mode reviews everything once without changing FSRS state or the log |
| 8 Anki features | PARTIAL | Done: tags on notes (indexed, normalized), tag filter and search in the explorer, tag editor on the opened note, bulk move and bulk add or remove tags for the selection, deck paths shown in deck pickers, suspend and bury, guided tours and tooltips. Open: note types and templates, cloze, image occlusion, filtered decks, undo, Web Push, `.apkg` import and export |
| 9 AI skills | TODO | SKILL.md files for card writing, deck maintenance, deck building |

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

- Not yet deployed to Vercel; production env vars and the Resend domain are untested.
- `pnpm lint` (Biome) reports 18 warnings and no errors (17 are upstream a11y warnings).
- AGPL obligations if hosted publicly with changes.
- Free-tier limits quoted here are from memory; verify them before relying on them.

## 11. Next steps (see HANDOFF.md for the live list)

1. Create the Vercel project (root `app`, branch `next-migration`), set `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, then deploy and re-check sign-in and sync on the live URL.
2. Add the Resend key and a verified domain so password-reset emails send.
3. Phase 3 hardening, then Phase 4 media (R2) and Phase 5 MCP.
