# Dev guide

Run everything from the repo root (the `app/` folder of the workspace) with pnpm.

## Commands
| Task | Command |
|---|---|
| Dev server (webpack) | `pnpm dev` (port 3000); in Claude use preview `skola-next` from `.claude/launch.json` |
| Production build | `pnpm build` |
| Lint / format | `pnpm exec biome check --write` |
| Typecheck | `pnpm lint:type` |
| Tests | `pnpm test` (Vitest) |
| Apply DB migrations | `pnpm db:push` |
| Extract i18n strings | `pnpm extract` |

Green baseline: typecheck clean, 107 tests in 18 files, build passes, Biome 18 warnings.

The dev preview config is `.claude/launch.json` one level above the repo (`skola-next`, port 3000).

## Environment
`.env.local` (gitignored; template `.env.example`). Names only here, never values:
`DATABASE_URL` (Supabase pooler), `AUTH_SECRET`, optional `APP_URL`, `ALLOW_SIGNUP`, `RESEND_API_KEY`, `EMAIL_FROM` (see `.env.example`). Without a Resend key, dev prints the reset code in the server log.
A local PGlite server (`pnpm exec pglite-server --db=./.pglite --port=54329`) was used for local testing.

## Local login
Dev account used in browser checks: owner@skola.test (local dev only).

## Testing notes
- Server tests start with `// @vitest-environment node` and use PGlite.
- Client tests use fake-indexeddb.
- The optimizer needs a real browser worker; it cannot run in a Node probe.
- Test the UI at `http://localhost:3000/#/...` (hash routes). After big HMR changes, load a fresh URL (`?r=N`) to avoid a stale CSS state.

## MCP server
The connect and install instructions live in one place, `src/server/connectGuide.ts`: the MCP address (always `<APP_URL>/mcp`, from `mcpUrl()`), the steps for Claude Code, Claude web and desktop, ChatGPT, Cursor, Codex and others, and how to install the skill. `/skills` shows it to people with a copy button on every address and command; `/llms.txt` is the same content as markdown for AI agents (the human page's "copy for an AI agent" button copies exactly that text). Edit the guide there and both follow; `connectGuide.test.ts` checks they agree. The profile menu in the app also links to the page and copies the address.
Endpoint `/mcp` (POST, Bearer token with `aud = <APP_URL>/mcp`). Connect Claude Code: `claude mcp add --transport http skola <APP_URL>/mcp` (it runs the OAuth flow). Claude Desktop cannot use a plain HTTP endpoint; use the remote connector over HTTPS, or `npx mcp-remote <APP_URL>/mcp` (not tried yet). To test locally without touching real data: run PGlite with `@electric-sql/pglite-socket`, apply `supabase/migrations`, start `next dev` with `DATABASE_URL` pointing at it and `APP_URL=http://localhost:<port>`, then drive `/oauth/authorize` with a PKCE client.

## Picture storage (Cloudflare R2)
Pictures are optional-to-configure: without the four `R2_*` variables the app keeps pictures inside their notes (small data URLs). To turn R2 on:
1. Cloudflare dashboard, R2, create a bucket (keep it private, no public access).
2. R2, Manage API tokens, create a token with Object Read & Write on that bucket. Note the Account ID, Access Key ID and Secret.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in `.env.local` and in Vercel (names only here; values never go in the repo).
4. Bucket, Settings, CORS policy, so browsers may upload and download (replace the origin with `APP_URL`):
```json
[{"AllowedOrigins": ["https://your-app.example"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["content-type"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600}]
```
5. Apply `supabase/migrations/20261103000000_media.sql` with `pnpm db:push`.
6. Run `pnpm r2:check`. It uploads, checks, downloads and deletes one tiny test object with your `.env.local` settings, tests the CORS rule for `APP_URL`, and prints a PASS or FAIL line for each step with the likely cause. Fix any FAIL before relying on pictures.

With wrangler (logged in with `npx wrangler login`) the bucket and CORS rule are two commands; the access key still comes from the dashboard. The bucket `skola-media` was created this way, with the rule in `scripts/r2-cors.json` (localhost only for now). When the app has its real address, add it to `origins` in that file and run:
```bash
npx wrangler r2 bucket create skola-media
npx wrangler r2 bucket cors set skola-media --file scripts/r2-cors.json
```

Limits: 15 MB per picture, 200 MB per account (constants in `src/server/media.ts`). Browsers upload straight to R2, so the limit does not depend on Vercel; a picture sent over MCP as base64 does pass through Vercel, which caps a request at about 4.5 MB, so large pictures over MCP should be sent as `image_url`.
The browser uploads straight to R2 with a 10-minute presigned link, then asks the server to confirm; reads use 1-hour presigned links after an ownership check. To test without Cloudflare, run any S3-compatible server and set `R2_ENDPOINT` (the repo tests use an in-memory fake). Objects are never deleted automatically.

## Agent skills
Stored in `skill_files` (owner `''` is the shared default, otherwise a user id) with `skill_history` for undo. The default skill in `src/server/skillSeed.ts` only seeds an empty table; after that edit it at `/skills/edit` (admins, see `SKILL_ADMINS`) or over MCP with `scope: "default"`. Public, no login: `/llms.txt` (about the product), `/llms-skill.txt` (the skills, full text), `/skills`, `/skills/<name>/<file>`, `/skills/<name>/bundle.zip`. A user's own skills are private and only reach them through MCP and the editor. Apply the migration with `pnpm db:push`.

## Tooling quirks
- Long Bash heredocs with apostrophes fail ("unexpected EOF"): write files with the Write tool and run Python patch scripts from the scratchpad.
- Biome reformats files; re-grep exact strings before patching.
- Write tool requires a fresh Read if the file changed on disk.
- Git push prints a harmless `aws codecommit credential-helper` error.

## Demo account
`pnpm db:seed` (reads `DATABASE_URL` from `.env.local`) creates one demo account with a deck of every card type (basic, cloze, multiple choice, list recall, image occlusion). The email and password are constants at the top of `src/server/seed.test.ts`; it is safe to run twice. The same file runs against an in-memory database as a normal test. Do not seed a database you do not mean to put demo data in.
