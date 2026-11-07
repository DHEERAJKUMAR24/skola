# Plan: redesign the master card (cheat-sheet, diagram, linked-card scoring)

- **Status:** PLAN, superseded by `docs/spec-master-card.md` (2026-11-07). Steps 1 to 5 are done in that spec; step 6 (approval) and step 7 (build) remain. Kept for the record of how the design was reached.
- **Goal:** a master card that is a compact, visual cheat-sheet of a concept (a group of masters per concept), instant to revise, whose answers update its linked cards honestly. Originals always stay in study (owner decision).
- **Related:** `docs/adr/0014-master-card-design.md`, `docs/spec-targeted-review.md` (Phase 22).

## Open design questions (what this plan must settle)

1. **Revise vs Open (settled).** The self-marked Revise idea was dropped after the owner's review of a prototype; testing now goes through the real study screen on the linked cards, and the sheet is read-only. See `spec-master-card.md` section 2.
2. **Linked-card scoring.** Per-entry recall becomes a review on the entry's card; one rating copied to all cards is ruled out. Open: how early reviews (card not yet due) are handled, and whether Hard exists on a got-it/missed mark.
3. **Diagram.** Which first: structure map, process flow, or both; Mermaid was considered and rejected; the owner approved @xyflow/react with dagre. Box id = entry id so Revise can hide labels.
4. **"A group of masters per concept".** The default hierarchy (Domain, Subject, Chapter, Concept) makes Concept a single entry inside a master. Rename levels, or let a master sit under a concept.
5. **AI button.** "Ask AI" builds a prompt (ids only, no names or card text), copies it, opens the chosen assistant; the assistant works through MCP and results sync back (drafts wait for approval). Which action first.

## Steps

| # | Step | Tool | Output | Decision for the owner |
|---|---|---|---|---|
| 1 | **Research** | `bmad-deep-recon` (web search allowed) | A short evidence report: do diagrams, concept maps and cheat-sheets help retention and teaching; what do Anki, RemNote, Obsidian canvas, Mochi, Orbit, Mermaid-in-notes do; do `?q=` prompt links work today for Claude, ChatGPT, Gemini, Perplexity (test each) | none, read the report |
| 2 | **Panel** (the party room; BMAD party mode is not installed here) | `superpowers:dispatching-parallel-agents`, 4 agents with fixed roles: learning scientist, medical student who teaches, architect (local-first, MCP-only AI, bundle size), sceptic who argues against building it | The agents argue questions 1 to 4 using step 1; I return their disagreements and a recommendation, not a vote | pick on each open disagreement |
| 3 | **Finish the design** | `superpowers:brainstorming` | `docs/spec-master-card-redesign.md`, with approaches, goals, non-goals, anti-goals, calls I made | answer one question at a time |
| 4 | **Check fit** | `bmad-agent-architect`, then a fresh builder reviewer | Fit with sync, MCP, Dexie versions, FSRS rule (policy only changes `due` and `scheduled_days`); gaps list | answer only the questions only the owner can |
| 5 | **Product check** | `bmad-agent-pm` | Is the scope worth it; cut list; where it sits relative to Phase 22 (targeted review) and Phase 20 (stats) | confirm scope and order |
| 6 | **Approve** | owner | Written design approved: the gate before any code | approve or change |
| 7 | **Plan and build** | `superpowers:writing-plans`, `test-driven-development`, `subagent-driven-development`, `verification-before-completion`, then `code-review` | Phased build, each phase tested and checked in a browser | per-phase go |

## Suggested build order after approval (draft, step 3 settles it)

1. Pure logic: per-entry marks to reviews, honest scoring rules, tests.
4. "Ask AI" button and prompt templates, fusion drafts first.
5. Concept grouping of masters, deck page view.
6. MCP: tools and `skola` skill steps for the above.

## Risks to watch

- Revise taking too long to be used; Open must stay the instant path.
- A diagram library that bloats the PWA or does not work offline.
- Mark-based reviews inflating card stats if "got it" is too easy; keep the full-pass honesty (hidden, then reveal, then mark).
- Prompt links breaking when an assistant changes its URL format; copy-first fallback always works.
- No cron, no polling, no server tables; anything that needs one is out.

## Rough effort

Research and panel: about one session. Design plus checks: one session. Build: several sessions, in the order above.
