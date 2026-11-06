# 0015. Workflows are skills plus the study-session state machine, not a workflow engine

Date: 2026-11-06
Status: Accepted (the owner can reverse it)

## Context
The Flash comparison listed a "workflow engine" as something Skola lacks: named, multi-step processes (make cards from a source, tutor a topic, clean a deck, audit quality, quiz) with approval gates and recorded state. Skola now has five default skills (`skola`, `skola-active-learning-tutor`, `skola-card-architect`, `skola-deck-maintainer`, `skola-quality-auditor`; `src/server/skillSeed.ts`, `skillSeedLearning.ts`, ADR 0006 skills in Postgres) and a server-side study-session state machine (ADR 0013). The assistant is the runtime; Skola holds the data and the rules that must not depend on the model behaving.

Note for the reader: the Flash comparison document itself is not in this repository. The "Flash workflow" column below names the workflow families as they were described in the handoff and plan, not a quotation. Check the rows against the original and correct them.

## Decision
Do not build a workflow engine (no stored workflow definitions, no step runner, no scheduler). A workflow is a skill: written steps the assistant follows, with tools as the only way to change data. State that must be exact lives on the server: the study-session phases, confirm tokens for deletes, idempotency keys, the mastery rules. Everything else is guidance in skill text.

## Mapping
| Workflow family | Covered by | Enforced by the server or only by text |
|---|---|---|
| Quiz / review what is due | `skola` (references/quizzing.md) with `start_study_session`, `next_card`, `show_answer`, `submit_review`, `end_session` | Server: open card pinned, answer before grade, one saved review per turn, 2 h expiry |
| Teach a topic, check understanding, assess | `skola-active-learning-tutor` with `create_objective`, `record_assessment`, `get_objective`, `get_objective_overview` | Server: K/S rules, rating 4 needs 0 hints and independent work, server timestamps. Text: the retrieve-first teaching order |
| Make cards from a source | `skola-card-architect` with `list_cards`, `find_duplicates`, `find_similar_cards`, `add_cards` (all types including reverse), `create_image_occlusion_cards`, `link_cards` | Server: validation per card type, idempotency for occlusion. Text: atomic-card gates, source tracing, show-before-write |
| Clean up and reorganise a deck | `skola-deck-maintainer` with `find_leeches`, `find_similar_cards`, `edit_card`, `move_cards`, `bulk_update_cards`, `delete_cards`, `card_history`, `restore_card_version` | Server: delete needs a confirm token tied to the exact contents; edits keep 7 days of history. Text: plan table, approval, coverage check |
| Audit quality, coverage, claims | `skola-quality-auditor` (read-only tools) | Text only; it has no write tools to misuse by design |
| Duplicate detection | `find_duplicates` (exact), `find_similar_cards` (similar wording, no AI) | Server |
| Exam preparation | deck exam date and presets (`update_deck`, `update_preset`) in `skola` | Server (scheduling policy) |
| User-defined workflows | per-user skills (create, edit, delete over MCP and at `/#/settings/skills`) | Text only |

## Not covered (honest list)
- **Scheduled or triggered runs.** Nothing runs by itself: no cron, no "every Sunday audit the deck", no webhook. The assistant only acts when the user opens a conversation.
- **Server-enforced step order outside study sessions.** "Show before you write", "inspect before you change" and the card-quality gates are instructions. A model that ignores them can still call `add_cards`. Only deletes (confirm token) and grading (session state) are enforced.
- **Run records.** No log of which workflow ran, what it planned and what it changed. `card_history` and review logs record data changes only; there is no plan/approval trail.
- **Resumable multi-step plans.** If a maintenance plan is half done and the conversation ends, nothing stores the plan.
- **Import pipelines.** No Anki, PDF or web-page ingestion in Skola; the assistant reads the source itself and calls `add_cards`.
- **Workflow versioning and evals.** Skill text is edited live; there is no version history or test loop (the skill-creator eval loop is still open in HANDOFF).
- **Conditional branching defined as data.** Branches exist only as prose in the skills.

## Consequences
Cheap and flexible: improving a workflow means editing text, and it works with any MCP client. The cost is that most gates depend on the model following the text. If a gap above starts to hurt (for example half-finished clean-ups), add the narrowest server piece for that gap (a saved plan row, or a scheduled job) rather than a general engine. Revisit this ADR then. Reversing it means superseding this file with a design for stored workflows.
