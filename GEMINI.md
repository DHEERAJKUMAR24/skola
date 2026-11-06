@AGENTS.md

## Gemini Assistant Specifics

Follow all rules in:
- [Coding Guidelines](file:///D:/Workspace/z-personalWorkspace/skola/.agent/rules/coding_guidelines.md)
- [AGENTS.md](file:///D:/Workspace/z-personalWorkspace/skola/app/AGENTS.md)
- [CLAUDE.md](file:///D:/Workspace/z-personalWorkspace/skola/app/CLAUDE.md)

### Key Rules
- **Always write plans, specs, and roadmaps as persistent markdown files in `docs/`**.
- Definition of done: `pnpm exec biome check --write && pnpm lint:type && pnpm test`.
- Dexie live-query arrays are read-only: `[...rows].sort()`.
- Floating UI above modals needs the Popover API; `z-index` loses to `<dialog>`.
- FSRS policy may only adjust `due` and `scheduled_days`, never stability or difficulty.
- End of session: update `docs/HANDOFF.md` and `docs/SPEC.md`.
