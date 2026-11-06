# Universal Agent Coding & Workflow Guidelines

These instructions apply to ALL AI assistants and coding agents (Gemini, Claude Code, Antigravity, Codex, Cursor, etc.) operating in this workspace.

---

## 1. Cardinal Rule: Specs & Plans Must Live in the Codebase

- **Never leave plans or specs in chat:** Whenever analyzing features, designing architecture, comparing APIs/tools, or creating implementation roadmaps, **always write the plan as a markdown file inside `app/docs/`** (e.g., `app/docs/spec-<feature>.md`).
- **Update Tracking Files:**
  - Record new phases/features in the phase table of [`app/docs/SPEC.md`](file:///D:/Workspace/z-personalWorkspace/skola/app/docs/SPEC.md).
  - Record progress, session actions, and next steps in [`app/docs/HANDOFF.md`](file:///D:/Workspace/z-personalWorkspace/skola/app/docs/HANDOFF.md).
  - Document major architectural decisions in [`app/docs/adr/`](file:///D:/Workspace/z-personalWorkspace/skola/app/docs/adr/) using `template.md`.

---

## 2. Commands & Definition of Done

Run commands using `pnpm` from the `app/` directory:
```bash
pnpm install
pnpm dev                          # http://localhost:3000 (webpack)
pnpm lint:type                    # tsc --noEmit
pnpm exec biome check --write     # lint + format
pnpm test                         # vitest run
pnpm build                        # next build --webpack
pnpm db:push                      # apply supabase/migrations
```

**Definition of Done for every change:**
1. `pnpm exec biome check --write` must pass cleanly (Biome keeps 18 known a11y warnings; do not add new warnings or errors).
2. `pnpm lint:type` (`tsc --noEmit`) must be 100% clean.
3. `pnpm test` must pass (server tests use PGlite with `// @vitest-environment node`).
4. `pnpm build` must succeed for any change touching routes, configs, or server entry points.
5. UI changes must be verified in a browser.

---

## 3. Core Architecture Rules

1. **Local-First Data Flow:**
   - The UI reads and writes Dexie (IndexedDB) only; the server is an asynchronous sync relay.
   - For any local database schema change, add a new Dexie version (never edit an old one).
2. **FSRS Scheduling Invariants:**
   - **Never rewrite stability or difficulty.**
   - Scheduling policy (`src/logic/scheduling/policy.ts`) may **only** adjust `due` (whole-day alignment, exam buffer) and `scheduled_days` (maximum interval cap). Stability, difficulty, reps, and lapses are strictly calculated by `ts-fsrs`.
3. **Dexie Immutability:**
   - Dexie live queries return read-only arrays. **Always copy before sorting:** `[...rows].sort()`. Mutating live query arrays throws in runtime.
4. **Modals & Popovers:**
   - Floating UI rendered over modals must use the HTML Popover API (`top layer`). Standard CSS `z-index` loses against native `<dialog>` elements.
5. **Auth & Security:**
   - Tokens are opaque with audience binding (`aud`). Never switch to JWT access tokens (see ADR 0005).
   - Never print, log, or commit secrets. Keep local keys in `.env.local` only.
6. **Free-Tier Budget:**
   - Keep API calls minimal; batch and debounce sync and persistence operations. Never introduce background polling.
7. **Tooling & Editing Hygiene:**
   - Use dedicated file writing/editing tools. Do not use Bash heredocs containing apostrophes/quotes.
   - Biome reformats files on write; re-read files before executing exact-string targeted patches.
   - Git work belongs on the `next-migration` branch. Commit and push only when explicitly requested by the user.

---

## 4. End-of-Session Handoff Protocol

Before completing any task or ending a turn:
1. Run all Definition-of-Done validation commands (`biome`, `lint:type`, `test`).
2. Update [`app/docs/HANDOFF.md`](file:///D:/Workspace/z-personalWorkspace/skola/app/docs/HANDOFF.md) with what was done, what remains unverified, and next steps.
3. Update [`app/docs/SPEC.md`](file:///D:/Workspace/z-personalWorkspace/skola/app/docs/SPEC.md) if phases or milestones were added or completed.
4. Add any newly discovered traps to [`app/docs/gotchas.md`](file:///D:/Workspace/z-personalWorkspace/skola/app/docs/gotchas.md).
