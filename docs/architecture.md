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
