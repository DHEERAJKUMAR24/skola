# Architecture

## Local-first
All reads and writes hit Dexie. The UI uses `useLiveQuery`. The server is only a sync relay plus auth. Offline works fully; sync catches up later.

## Sync
- Synced tables: `decks`, `cards`, `notes`, `settings`, `presets` (`SYNCED_TABLES` in `src/logic/syncTracking.ts`). Review logs and statistics stay local.
- Dexie hooks stamp `updatedAt` on every write and write tombstones on delete.
- Push is debounced (user setting from 5 s to 15 min; profile avatar shows a countdown ring). Pull is incremental.
- Server keeps a `changes` table with a per-user `seq`. Table whitelist is in `src/server/sync.ts`.
- Wire key path differs per table: `settings` is keyed by `key`, others by `id` (`keyPathOf` in `src/logic/sync.ts`).
- Settings got an `updatedAt` backfill in Dexie v26 so existing settings sync once.
- Endpoints: `GET /api/sync/pull`, `POST /api/sync/push`, `GET /api/me`. Kept few and batched to save the Vercel free tier.

## Auth
- Email + password only (scrypt). No passkeys. Password reset by email OTP via Resend.
- Auth.js with a JWT cookie used only for `/oauth/authorize`.
- API access uses OAuth 2.1 opaque tokens (`sk_at_`, `sk_rt_`, hashed in Postgres), PKCE S256, RFC 8707 `resource` stored as `aud` so tokens can target the app or a future MCP server, dynamic client registration, revoke, metadata endpoints.
- Lockout after repeated failed logins; tests in `src/server/oauth.test.ts`.

## Database
Supabase Postgres, migrations in `app/supabase/migrations`, applied with `pnpm db:push` (`npx supabase db push`). RLS enabled on all tables; the server connects with the pooler URL in `DATABASE_URL`.

## Client shell
`src/App.tsx` is the layout (sidebar, header, `<Outlet/>`, `TourHost`). `src/ClientRoot.tsx` defines routes and starts sync and `ensureDefaultPreset()`.

## Offline and sync coverage
- **PWA:** the service worker (`src/sw.ts`, built by Serwist, disabled in dev) precaches the app shell `/` and `/offline`, plus `_next/static` and `public/`. Because routing is hash-based, every study screen is the `/` shell and opens with the server down. Any other page that cannot load (login, signup, `/skills`, consent) shows `/offline`. Sync and auth requests are network-only. `reloadOnOnline` is off so coming back online never reloads a study session.
- **Synced, debounced:** decks, cards, notes, review logs, study sessions, settings, presets (and tombstones for deletes). Study sessions are one append-only row per finished session; per-day totals are added up when read (`getStatistics`), so two devices on the same day never overwrite each other. Every local write marks `updatedAt` and fires `local-change`; the scheduler pushes after the quiet time (default 10 s, max wait 60 s or twice the delay) and once more when the page hides. Pulls happen on start, focus (at most every 2 min), reconnect and every 15 min while visible.
- **Local only, on purpose:** the legacy `statistics` table (kept untouched after the v27 migration copied it into sessions), auth tokens and sync cursors, the push-delay preference and first-run flags (per device).
- **Server only:** a user's own agent skills (assistants read them from the server); the editor and MCP tools need a connection.

## Pictures
A note stores `media:<sha256>` for a picture. The bytes sit in the local-only `media` table (IndexedDB) and, after a background upload, in R2 at `u/<user>/<sha256>`. `src/logic/media/media.ts` saves, uploads (`uploadPending`, called after each sync, makes no request when nothing is waiting), resolves (`resolveMedia`, downloads once and checks the fingerprint) and moves old inline pictures out of notes (`migrateInlineImages`, once per session). `useMediaSrc` / `useMediaHtml` turn references into URLs for display; the TipTap image node does the same inside the editor. Server side: `media_objects` records ownership and size for quota and access checks.
