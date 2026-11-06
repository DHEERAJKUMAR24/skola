# 0012. Knowledge and skill mastery from evidence, not from card ratings

Date: 2026-11-03
Status: Accepted

## Context
Card reviews show recall of one fact. They do not show that a person understands a topic or can apply it. We want a model an assistant can fill in during tutoring, with rules that stop it from inflating results.

## Decision
Learning objectives have a Knowledge track (K) and a Skill track (S), each with four dimensions rated 0 to 4. Pure rules live in `src/logic/learning/mastery.ts`:
- untested is not 0; the score is sum/16*100 only when all four dimensions are tested;
- mastery needs a score of 85 or more, no dimension under 3, unaided recall and explanation, independent skill work, and a second good result at least 7 days after the first;
- the server sets timestamps; a rating of 4 needs zero hints and independent work.
Tools in `src/server/mcpEvidence.ts`: create_objective, update_objective, list_objectives, get_objective, record_assessment (idempotency_key), link_cards, delete_objective (confirm token), get_objective_overview (a read-only per-objective summary; renamed from get_master_card, which stays as a deprecated alias). Tables `learning_objectives`, `objective_cards`, `objective_assessments` are server only. Four skills use it: skola-active-learning-tutor, skola-card-architect, skola-deck-maintainer, skola-quality-auditor.

## Consequences
Rules are testable without a database. Evidence does not sync to devices, so the app page (`/objectives`, 2026-11-06) reads and writes it through `/api/objectives`, which runs the MCP tools through `src/server/appApi.ts`: one set of validation and confirm-token rules for both clients, and the page needs sign-in and a connection. `list_objectives` now includes the latest rating per dimension, and `get_objective` takes `evidence_limit` and returns `card_ids`, so the app needs no extra queries. The manual assessment form repeats the server checks in `src/logic/learning/assessmentForm.ts`; a test runs both on the same cases so they cannot drift. The "master card" is a different, planned feature (see ADR 0014, proposed); the old `get_master_card` name collided with it, so it was renamed `get_objective_overview` (2026-11-06).
