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
| [adr/](adr/) | One file per significant decision (Michael Nygard format) | A decision is made or reversed |

ADR rules: number sequentially, never rewrite history; to reverse a decision add a new ADR that supersedes the old one and mark the old status "Superseded by NNNN".
