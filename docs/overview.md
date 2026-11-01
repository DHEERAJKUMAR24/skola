# Overview

## Goal
A free, cloud-hosted, local-first spaced-repetition app. Works offline as a PWA, syncs across devices, uses full FSRS-6 with Anki/RemNote-style settings. Must run inside free tiers (Vercel + Supabase), so API calls are kept minimal.

## Stack
- Next.js 16 (webpack build), React 19, TypeScript, React Router (hash router) inside a client-only catch-all (`app/[[...slug]]`).
- Dexie (IndexedDB) is the source of truth on the device. Serwist PWA.
- ts-fsrs 5.4.2 (FSRS-6, 21 weights). fsrs-browser (WASM) for the optimizer, in a Web Worker.
- Auth.js (Credentials) + own OAuth 2.1 server. Supabase Postgres via `pg` and the transaction pooler, RLS on all tables.
- Vercel hosting. Resend for OTP email. R2 reserved for media only (image occlusion etc.), not built yet.
- driver.js 1.10.2 (MIT) for guided tours.
- Vitest + fake-indexeddb + PGlite for tests. Biome for lint/format (17 upstream a11y warnings tolerated, now 18).

## Repo layout (repo root = the `app/` folder of the workspace)
- `app/` Next route handlers: `api/auth`, `api/account/{signup,forgot,reset}`, `api/me`, `api/sync/{pull,push}`, `oauth/*`, `(auth)` pages.
- `src/logic/` data layer: `db.ts` (Dexie versions to 26), `sync*.ts`, `learn.ts`, `deck/`, `card/`, `note/`, `scheduling/policy.ts`, `fsrs/`, `seed/`, `settings/`.
- `src/server/` server-only: `auth.ts`, `oauth.ts`, `sync.ts`, `users.ts`, `reset.ts`, `email.ts`, `db.ts`, `crypto.ts`.
- `src/app/` UI views: home, deck, learn, explorer (notes), editor, settings (+ `presets/`), statistics, shell, login.
- `src/components/` shared UI: `ui/` primitives, `InfoTip/`, `Tour/`, `Profile/`.
- `supabase/migrations/` SQL (`20261101000000_init.sql`).

## Constraints from the owner
- Notion access only through the `ntn` CLI (never an MCP/connector); ask before changing Notion.
- Never print secrets. The generated Supabase DB password lives only in `app/.env.local`.
- Cloud-side permanent deletions are left to the owner.
- Commit and push only when asked.
