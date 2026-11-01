# AGENTS.md

Instructions for any AI coding agent (Claude Code, Codex, Cursor, Copilot, ...) working in this repo. Humans: see `README.md`. Read this file first, then `docs/README.md`.

## What this is
Skola fork: a free, local-first spaced-repetition PWA. FSRS-6 scheduling, Anki/RemNote-style study presets, sync across devices, own OAuth server (for a future MCP server). Hosted on Vercel + Supabase free tiers. AGPL-3.0 (fork of h16nning/skola).

## Where to look
| Need | File |
|---|---|
| Product spec, requirements, phase status | `docs/SPEC.md` |
| Current status, what to do next, open risks | `docs/HANDOFF.md` |
| How the system fits together | `docs/architecture.md` |
| Scheduling, presets, optimizer | `docs/fsrs-and-presets.md` |
| Feature inventory per module | `docs/features.md` |
| Why a choice was made | `docs/adr/` (one file per decision) |
| Setup, commands, env, testing, troubleshooting | `docs/dev-guide.md` |
| Bugs already hit, traps | `docs/gotchas.md` |

## Commands (run in this directory, pnpm)
```bash
pnpm install
pnpm dev                          # http://localhost:3000 (webpack)
pnpm lint:type                    # tsc --noEmit
pnpm exec biome check --write     # lint + format
pnpm test                         # vitest run
pnpm build                        # next build --webpack
pnpm db:push                      # apply supabase/migrations
```
Definition of done for any change: `pnpm exec biome check --write`, `pnpm lint:type`, `pnpm test` all clean (Biome keeps 18 known a11y warnings; do not add more without reason), and `pnpm build` for anything touching routes or config. UI changes must also be checked in a browser.

## Layout
- `app/` Next route handlers and pages (`api/`, `oauth/`, `(auth)/`, `[[...slug]]` client-only SPA mount).
- `src/logic/` client data layer (Dexie `db.ts`, sync, learn, scheduling, presets, fsrs).
- `src/server/` server-only code (auth, oauth, sync, email, pg).
- `src/app/` UI views. `src/components/` shared UI (`ui/`, `InfoTip/`, `Tour/`, `Profile/`).
- `supabase/migrations/` SQL migrations. Never edit an applied migration; add a new one.

## Rules
- **Local-first:** UI reads and writes Dexie only; the server is a sync relay. Add a Dexie version (never edit an old one) for any schema change.
- **Sync tables** are listed in `src/logic/syncTracking.ts` and whitelisted in `src/server/sync.ts`. Change both together and add a migration if the server shape changes.
- **FSRS:** never rewrite stability or difficulty. Policy (days, easy days, exam, max interval) only changes `due` and `scheduled_days`, in `src/logic/scheduling/policy.ts`.
- **Free-tier budget:** keep API calls minimal; batch and debounce. Do not add polling.
- **Secrets:** never print, log or commit. `.env.local` is gitignored; document new vars in `.env.example` and `docs/dev-guide.md` by name only.
- **Auth/tokens:** opaque tokens with `aud`; do not switch to JWT access tokens (see `docs/adr/0005`).
- **UI:** every new setting or module gets a tooltip (`InfoTip`/`LabelWithTip`) and, for a new page, an entry in `src/components/Tour/tours.ts`. Floating UI over modals must use the Popover API (top layer).
- **Dexie live queries** return read-only arrays: copy before sorting.
- **Tests:** add or update tests for logic changes (Vitest; server tests use PGlite with `// @vitest-environment node`).
- **Style:** match surrounding code; Biome formats. Keep comments to the non-obvious why.
- **Git:** work on `next-migration`; commit and push only when the owner asks. Conventional-style messages.
- **Notion:** use only the `ntn` CLI, never an MCP/connector; ask before changing Notion content.
- **Docs are part of the change:** when behavior, commands, status or a decision changes, update the matching file in `docs/` in the same change. Record a new significant decision as a new ADR (`docs/adr/template.md`). Update `docs/HANDOFF.md` at the end of every session.

## Handoff protocol (end of a session)
1. Run the definition-of-done commands.
2. Update `docs/HANDOFF.md` (done, in progress, unverified, next, uncommitted work).
3. Update `docs/SPEC.md` phase table if a phase changed.
4. Add ADRs for new decisions; add traps to `docs/gotchas.md`.
