# 0013. MCP study sessions with idempotent reviews, and profile instructions

Date: 2026-11-03
Status: Accepted

## Context
An assistant that quizzes the user must not grade the wrong card, grade twice on a retry, or skip the answer reveal. Users also want standing preferences that every assistant follows without pasting them each time.

## Decision
Study sessions (`src/server/mcpStudy.ts`, table `mcp_study_sessions`): `start_study_session`, `next_card`, `show_answer`, `submit_review`, `end_session`. A session pins the open card and phase (asked, revealed, grading). `submit_review` needs the open card id and a prior `show_answer`. The review log id is a hash of user, session and turn, so a retry returns the saved result with `duplicate: true`. Sessions expire after 2 hours idle. Grading goes through the shared `gradeCard` in `mcpWrite.ts`, so the app and MCP use one scheduling policy.

Profile instructions: synced setting `#aiInstructions` (max 4000 chars). Never saved means the built-in default (`DEFAULT_AI_INSTRUCTIONS`); `""` means none on purpose; reset deletes the row. `initialize` puts the first 1500 chars in `<user_instructions>` tags; `get_instructions` and `set_instructions` (append, replace, reset) cover the rest. Instructions never override safety or tool rules.

## Consequences
No new sync code for instructions, because they ride the settings sync. Two truly simultaneous identical submits are guarded by an update claim, not a row lock. Not tested with a real MCP client.
