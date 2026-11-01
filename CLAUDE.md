@AGENTS.md

## Quick start
```bash
pnpm install && cp .env.example .env.local   # DATABASE_URL, AUTH_SECRET (APP_URL, RESEND_API_KEY, EMAIL_FROM optional)
pnpm dev                                      # :3000, webpack
pnpm exec biome check --write && pnpm lint:type && pnpm test   # must be clean before finishing
```

## Claude Code specifics
- Preview: `skola-next` in `../.claude/launch.json` (port 3000, runs `pnpm --dir app dev`). Hash routes: `http://localhost:3000/#/home`. After big HMR edits load a fresh `?r=N` URL.
- Local test account is documented in `docs/dev-guide.md` (dev only).
- Write multi-line files with the Write tool; long Bash heredocs with apostrophes fail. Biome reformats files, so re-read before exact-string patches.

## Traps (details in `docs/gotchas.md`)
- Dexie live-query arrays are read-only: `[...rows].sort()`.
- Floating UI above modals needs the Popover API; `z-index` loses to `<dialog>`.
- FSRS policy (`scheduling/policy.ts`) may only change `due`/`scheduled_days`, never stability or difficulty.
- Add a new Dexie version for schema changes; never edit old ones.
- End of session: update `docs/HANDOFF.md`.
