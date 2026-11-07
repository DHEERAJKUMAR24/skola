# Documentation index

Docs follow the common agent-ready layout: `AGENTS.md` (entry point), a spec, architecture notes, decision records (ADRs), a runbook and a handoff file.

| Doc | Purpose | Update when |
|---|---|---|
| [../AGENTS.md](../AGENTS.md) | Entry point for agents: commands, rules, definition of done | Rules or commands change |
| [SPEC.md](SPEC.md) | Requirements, design, phase table, accounts, risks | A requirement or phase changes |
| [HANDOFF.md](HANDOFF.md) | Current status, uncommitted work, next steps | End of every session |
| [overview.md](overview.md) | Goal, stack, layout | Stack changes |
| [architecture.md](architecture.md) | Local-first data flow, sync, auth, DB | Design changes |
| [fsrs-and-presets.md](fsrs-and-presets.md) | Scheduling model, presets, optimizer | Scheduling changes |
| [features.md](features.md) | What each module does | A feature ships |
| [dev-guide.md](dev-guide.md) | Runbook: setup, env, tests, quirks | Tooling changes |
| [gotchas.md](gotchas.md) | Traps already hit | A new trap is found |
| [spec-phase-16.md](spec-phase-16.md), [spec-phases-17-20.md](spec-phases-17-20.md), [spec-targeted-review.md](spec-targeted-review.md), [spec-master-card.md](spec-master-card.md), [spec-ask-ai.md](spec-ask-ai.md) | The designs for Phases 16 to 24, reviewed against the code, waiting for approval | A design is approved, changed or built |
| [plan-master-card-redesign.md](plan-master-card-redesign.md), [research-master-card-visual-revision.md](research-master-card-visual-revision.md) | How the master card design was reached, and the evidence behind it | Rarely; historical |
| [spec-comparison-flash-deep.md](spec-comparison-flash-deep.md), [spec-mcp-parity-flash.md](spec-mcp-parity-flash.md), [spec-feature-inspiration.md](spec-feature-inspiration.md) | Competitor comparison and ideas (reference only; the Phase 16 to 19 build specs are the two files above) | Rarely |
| [adr/](adr/) | One file per significant decision (Michael Nygard format) | A decision is made or reversed |

ADR rules: number sequentially, never rewrite history; to reverse a decision add a new ADR that supersedes the old one and mark the old status "Superseded by NNNN".
