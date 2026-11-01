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

## Tooling quirks
- Long Bash heredocs with apostrophes fail ("unexpected EOF"): write files with the Write tool and run Python patch scripts from the scratchpad.
- Biome reformats files; re-grep exact strings before patching.
- Write tool requires a fresh Read if the file changed on disk.
- Git push prints a harmless `aws codecommit credential-helper` error.
