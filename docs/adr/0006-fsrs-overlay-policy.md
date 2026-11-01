# 0006. ts-fsrs FSRS-6 with a policy overlay that only moves due dates

Date: 2026-11-01
Status: Accepted

## Context
We need whole-day scheduling, exam dates, easy days and a maximum-interval cap without corrupting the memory model.

## Decision
ts-fsrs computes stability and difficulty. `scheduleCard` in `src/logic/scheduling/policy.ts` then adjusts only `due` and `scheduled_days`. Reviews are logged append-only so state can be recomputed.

## Consequences
Memory-model data stays comparable with other FSRS tools and the optimizer. Policy rules must never touch stability or difficulty.
