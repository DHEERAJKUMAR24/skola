# 0018. MCP sessions apply daily limits in the learner's time zone (proposed)

Date: 2026-11-07
Status: Proposed (waiting for the owner's approval; see `docs/spec-phase-16.md`)

## Context
The app limits new cards per deck per day (`limitNewCards`, `useTodayActivity`), but the MCP study tools ignore presets and paused decks and take caller-supplied limits, so an assistant can serve more new cards than the learner chose. The server also has no notion of the learner's time zone: `logicalDayStart` uses the process's zone, which is UTC on Vercel.

## Decision
- The app writes a synced setting `#timeZone` (an IANA name) only when it is unset or the learner changes it in Settings, never on every launch. The server computes "today" from it with a pure `logicalDayStartIn(date, hour, timeZone)`; without it the server uses UTC and says so.
- MCP sessions count new cards seen today from the synced review logs (excluding manual rows, distinct cards, mapped to each card's current deck), compute the remaining budget per deck once at session start, store it on the session, and exclude paused decks.
- A daily boost is a synced setting keyed by logical date and deck; catch-up (Phase 22) overrides both preset and boost.
- Tool errors keep the `[code] message` convention and gain an additive `structuredContent: { code }`.

## Consequences
- One column on `mcp_study_sessions` (`new_budget jsonb`) and a behaviour change for assistants (they get fewer new cards than before).
- Counts are as fresh as each device's last sync, and the output says so.
- Old clients ignore `structuredContent`; older protocol versions simply do not see it.
