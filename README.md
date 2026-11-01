# Skola (fork)

A local-first spaced-repetition flashcard app, forked from [h16nning/skola](https://github.com/h16nning/skola) (AGPL-3.0). This fork replaces Dexie Cloud with its own free-tier backend so cards sync across devices, and prepares for an MCP server so AI assistants can read decks and quiz you.

## What it does

- **Local-first PWA.** Cards live in your browser (IndexedDB via Dexie) and the app works offline once installed. The server is only a sync point.
- **FSRS-6 scheduling** with [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs). Every review is stored in an append-only log.
- **Sync across devices.** Changes are pushed shortly after you edit and pulled on start, focus and every 10 minutes while the tab is visible. Idle tabs make no requests, to stay inside free tiers.
- **Accounts.** Email and password, with password reset by emailed code. Sign-in is optional: "Continue without signing in" keeps everything local.
- **OAuth tokens.** The server is its own OAuth 2.1 authorization server (PKCE, opaque tokens, refresh rotation). Each token is bound to an audience, `<APP_URL>/api` for the app and `<APP_URL>/mcp` for the planned MCP server.
- Normal, double-sided and cloze cards with rich text.

Not built yet: media and image occlusion (planned on Cloudflare R2), the MCP server, syncing settings and statistics.

## Stack

Next.js 16 (webpack) · React 19 · TypeScript · Dexie · Serwist (service worker) · Auth.js · Supabase Postgres (`pg`) · Resend (email) · Vitest · Biome

The whole UI runs in the browser (`app/[[...slug]]` mounts it client-only with a hash router); the server side is the route handlers under `app/api` and `app/oauth`.

## Run it locally

Needs Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then fill it in, see below
pnpm dev
```

Open http://localhost:3000. Without a database the app still works locally; sign-in and sync need `DATABASE_URL`.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres, the **Transaction pooler** string (port 6543): Project, Connect |
| `AUTH_SECRET` | Random 32+ characters (`openssl rand -base64 32`); signs the login cookie and hashes reset codes |
| `APP_URL` | Public URL, e.g. `https://skola.vercel.app`. Token audiences are built from it, so set it in production |
| `ALLOW_SIGNUP` | `true` (default) lets anyone register; `false` allows only the first account |
| `RESEND_API_KEY`, `EMAIL_FROM` | Password-reset emails. Without a key, dev prints the code in the server log and production refuses to send |

### Database

The schema is a Supabase migration in `supabase/migrations/`. With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
pnpm db:push
```

Row-level security is enabled on every table, so Supabase's public anon key cannot read them. The server connects directly as the table owner.

## Deploy

1. Create a Supabase project and apply the migration (above).
2. Import the repo in Vercel and set the project's root directory to this folder.
3. Add `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` (and the Resend variables) in Vercel's environment settings.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js (webpack) |
| `pnpm test` | Vitest (uses fake IndexedDB and in-memory Postgres, no setup needed) |
| `pnpm lint:type` | TypeScript check |
| `pnpm lint` | Biome |
| `pnpm db:push` | Apply migrations to the linked Supabase project |
| `pnpm extract` | Extract i18n strings |

## Layout

```
app/            Next.js routes: /api (sync, account, me), /oauth, /.well-known, login pages
src/server/     Server code: Postgres, sync, users, password reset, OAuth, email
src/logic/      Client logic: Dexie database, FSRS, sync, auth, change tracking
src/app/        Skola UI views
src/sw.ts       Service worker
supabase/       Migrations
```

## License

AGPL-3.0, like upstream Skola. If you run a modified version publicly you must publish your source. See `LICENSE`.
