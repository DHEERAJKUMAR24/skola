# 0016. The master card is a lens over the learner's cards (proposed)

Date: 2026-11-07
Status: Proposed (waiting for the owner's approval; supersedes nothing, extends 0014)

## Context
ADR 0014 made the master card a compact list of entries, each linked to one card. A first design for Phase 23 added a "Revise" mode in which hidden entries were recalled and self-marked, each mark writing a review to the linked card. The owner tried a prototype and judged it a memory game: shallow (labels only), a second review engine, one card per entry, no way to test understanding, no content to read, and no tie to the other card types. A concept page the owner admires (jsinterview.dev) reads well but has no retrieval or spaced repetition.

## Decision
The master card is the one screen for a concept and a lens over the learner's own cards, not a quiz of its own (details in `docs/spec-master-card.md`):
- An entry links to many cards of any note type. Strength comes from all of them.
- Read mode is a sheet built from cards and entries (diagram, key points, examples and common mistakes by tag, a short tips block, related masters). It writes nothing.
- Testing runs through the existing study screen: `/learn/<deck>/master.<noteId>` serves the due cards linked from the master in diagram order. No new review path; practice reuses cram.
- Arrows are first-class: opt-in relation cards (cards of the master note with an `edgeId`), and a what-if test computed from the arrows whose result is Predict evidence kept in a synced setting.
- A per-concept readiness measure (Recall, Explain, Predict, Apply; untested is not zero) in the spirit of ADR 0012, computed by pure modules shared with the MCP server.
- Diagram stored as data (entry ids and edges), drawn lazily with `@xyflow/react` and `@dagrejs/dagre`.
- Every AI-needing part has three doors: the human UI, MCP tools, and the Ask AI button (copy a prompt, open the assistant; `docs/spec-ask-ai.md`). The app never holds an AI key or calls an AI API.

## Consequences
- One review engine and one source of truth for scheduling; the master adds navigation, context and new kinds of card, not a competing quiz.
- Existing engines (coverage, suggested rating, MCP master tools) must read all cards of an entry; `cardId` stays for old data, so no migration.
- `cleanMaster` must keep the new fields or they are lost on save.
- No Dexie version and no cron. One small server migration (`mcp_study_sessions.master_id`), only for the MCP session. New dependencies (`@xyflow/react`, `@dagrejs/dagre`) load only when a diagram opens and must be confirmed in the service worker precache.
- Predict evidence is local and synced through settings; it is not a K/S assessment, and the server's objectives stay the record for tutoring evidence.
- Risks: authoring effort (mitigated by AI drafts the learner approves), a heavy diagram on small screens (list fallback, 25-box limit), and prompt links that change (user-editable list, copy first).
