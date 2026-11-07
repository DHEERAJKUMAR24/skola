# Skola++ vs Flash: Deep Comparative Analysis & Gap-Closing Specification

- **Status:** SPEC REVIEWED & CORRECTED — 2026-11-07. Architecture review applied: Phase 21 dropped (no polling/cron in Skola), Phase 20 redesigned as client-side, `get_limits` corrected (no review-log access server-side), speech blocks kept optional, `panel_reminders` uses Dexie synced settings, `set_limits` wraps preset system. All high-priority Flash Rust source files read; 3 sweep sessions 2026-11-07; Sections 11.1–11.23 added; Phases 16–20 specced; the ADRs listed in section 10 are proposed placeholders, none is written yet except 0016, which is now the master card decision.
> **READ FIRST (2026-11-07).** An independent code review found that the Phase 16 to 19 parts of this document assume things that are false about Skola (deck storage, MCP limits, existing auth and media code, existing stats route). The corrected, authoritative designs are `docs/spec-phase-16.md` (Phases 16.1 to 16.3) and `docs/spec-phases-17-20.md` (Phases 17 to 20). Where this document differs, those two win. The tool-by-tool comparison tables and the Flash analysis below remain useful as reference only. Sections 7 (Phases 16 to 19), 9, 10 and 11.1 to 11.22 must not be used as a build spec.

- **Author:** Antigravity Engineering (synthesized from 4-agent deep-recon run)
- **Date:** 2026-11-07
- **Supersedes:** `docs/spec-mcp-parity-flash.md` (Phase 16 overview); this document is the authoritative implementation spec
- **Tracking:** Phases 16 to 20 in `docs/SPEC.md` (21 dropped; Phases 22 to 24 are the owner's own designs, see `docs/README.md`)

---

## 1. Research Methodology

Four parallel research agents ran against both codebases simultaneously:

| Agent | Scope | Output |
|---|---|---|
| Flash MCP tools | All 26 Flash tools: schemas, behavior, error codes, grading rubric, panel protocol, speech blocks, system prompt | Full tool catalog |
| Flash architecture | SQLite schema (23+ tables), auth (WebAuthn + OAuth 2.1 PKCE S256), UI routes, Anki .apkg import/export, FSRS v6 pacing, media storage | Full arch report |
| Skola MCP server | All 56 Skola MCP tools: schemas, session logic, idempotency, skill seeds | Full tool catalog (this document) |
| Skola UI/Schema | 11 UI routes, Dexie schema (v22–v29), Postgres schema (15 tables), 7 note types, preset system | Full schema report |

Reference repos:
- Flash: `D:/Workspace/z-personalWorkspace/flash-ref` (cloned 2026-11-07, Rust/Axum/SQLite)
- Skola: `D:/Workspace/z-personalWorkspace/skola/app` (TypeScript/Next.js/Dexie/Postgres)

---

## 2. Tool Count Summary

| System | Total MCP Tools | Unique Advantages |
|---|---|---|
| Flash | 26 | Pacing limits, archive/unarchive, rename with re-parent, speech blocks, UI panels, Anki import |
| Skola++ | 56 | Master cards, K/S objectives, image occlusion, find_similar_cards, skill management, next_card skip, preset management, deck_schedule, set_card_schedule, full audit tooling |

Skola++ already has 2× the MCP surface. The goal is not to shrink to Flash's 26 — it is to add Flash's missing ergonomics while keeping and extending Skola++'s depth.

---

## 2.5 Skola Architecture Constraints

Before reading the gap analysis, these Skola-specific constraints override Flash's design decisions where they conflict:

| Constraint | Rule | Impact on spec |
|---|---|---|
| **Local-first** | UI reads/writes Dexie only; server is a sync relay | Stats, "remaining today" counts, and any feature needing live review data must run client-side |
| **No polling / no cron** | Non-goal N3 (few API calls); no cron job of any kind, not even a daily one | Phase 21 (background job system) dropped; R2 cleanup runs when the server receives the delete (see 11.15) |
| **Review logs sync** | Review logs do sync: `src/logic/sync.ts` pushes `reviewLogs` by `reviewedAt` (append-only, outside the `updatedAt` tracking in `syncTracking.ts`), and MCP grading writes them too. The server therefore holds every device's reviews up to its last sync. | `get_limits` can report "remaining today" from synced logs, accurate up to each device's last sync (say so in the tool output). Phase 20 stats stay client-side so they work offline. |
| **Preset system is canonical** | 15-parameter FSRS preset system + per-deck assignment | `set_limits` is a convenience wrapper, not a replacement |
| **K/S objectives system** | Phase 12: 4×4 dimension mastery tracking with dated evidence | `grading_mode` is a session UX preference; K/S handles competency measurement |
| **Free-tier budget** | Supabase free, Vercel Hobby | No server-side caching tables for stats; no background workers |
| **Speech blocks optional** | Skola is not voice-first | Speech blocks stay optional; not forced by schema |

---

## 3. Full Tool-by-Tool Comparison

### 3.1 Pacing & Daily Limits

| Flash Tool | Skola Equivalent | Gap |
|---|---|---|
| `boost_new_today` | None | ❌ Missing: ephemeral daily +N card boost, stored in settings as `DailyBoostRecord`, resets at user's `nextDayStartTime` (default 4 AM) |
| `get_limits` | `list_presets` + `get_deck` | ⚠️ Partial: Skola has the data but no single consolidated view of remaining daily allowances across all decks |
| `set_limits` | `update_preset` + `update_deck` | ⚠️ Partial: Skola supports the same fields but not via a single named-deck interface; `goal_date` exists as `exam_date` |

**Skola Plus (no Flash equivalent):** `list_presets`, `update_preset` (full preset management with learning steps, relearning steps, desired_retention, fuzz, easy days, leech config, personal weights).

### 3.2 Deck Operations

| Flash Tool | Skola Equivalent | Gap |
|---|---|---|
| `create_deck` | `create_deck` | ⚠️ Quality gap: Flash accepts `"Medicine::Cardiology"` path string with auto-parent creation; Skola requires explicit `parent_id` UUID |
| `list_decks` | `list_decks` | ⚠️ Missing `archived: boolean` flag in Skola output |
| `archive_deck` | `update_deck(paused: true)` | ⚠️ Partial: Skola pauses a single deck; Flash recursively marks entire tree with `archivedAt` timestamp and removes from all due counts |
| `unarchive_deck` | `update_deck(paused: false)` | ⚠️ Partial: same — Flash restores ancestors too |
| `rename_deck` | `update_deck` | ⚠️ Partial: Skola supports rename via `name` field, but no `Parent::Child` re-parenting path syntax |
| `delete_deck` | `delete_deck` | ✅ Parity: both use two-phase confirm token with affected counts |

**Skola Plus:** `get_deck` (full settings view), `deck_stats`, `deck_schedule` (7–30 day forecast), `move_cards`, `update_preset`.

### 3.3 Card Authoring

| Flash Tool | Skola Equivalent | Gap |
|---|---|---|
| `create_cards` | `add_cards` | ⚠️ Quality gaps: (1) Flash accepts `"Parent::Child"` deck path string; (2) Flash accepts HTML in `front`/`back`; (3) Flash accepts `front_speech`/`back_speech` speech blocks; (4) Flash has `basic_typed` variant for verbatim answer checking |
| `update_cards` | `edit_card` + `bulk_update_cards` | ✅ Parity |
| `delete_cards` | `delete_cards` | ✅ Parity: both use two-phase confirm token |
| `list_cards` | `list_cards` + `search_cards` | ✅ Parity |
| `restore_cards` | `card_history` + `restore_card_version` | ⚠️ Quality gap: Flash keeps 20 versions / 90 days; Skola keeps 7 days |

**Skola Plus:** `find_leeches`, `find_duplicates`, `find_similar_cards` (semantic), `get_card_details` (full FSRS state + recall now), `set_card_schedule` (bury/unbury/set_due/reset/override), `bulk_update_cards`, `move_cards`, `get_card_image` (image occlusion), `add_cards` supports `multiple_choice`, `list`, `image_occlusion`, `reverse` — Flash has only `basic` and `cloze`.

### 3.4 Study Sessions

| Flash Tool | Skola Equivalent | Gap |
|---|---|---|
| `start_study_session` | `start_study_session` | ⚠️ Partial: Flash supports `tags: string[]` multi-tag AND filtering; Skola supports only single `tag` |
| `show_answer` | `show_answer` | ✅ Parity |
| `submit_review` | `submit_review` + `grade_card` | ⚠️ Quality gap: Flash's `submit_review` description includes an explicit, uncompromising grading rubric ("facts, numbers, doses, units must match precisely; an imprecise answer is 1 (Again), never 'close enough'"). Skola relies on the skill files. |
| `end_session` | `end_session` | ✅ Parity |

**Skola Plus:** `next_card` (skip / re-fetch safely without grading), `grade_card` (direct card grading outside sessions), `get_due_cards`.

### 3.5 Interactive UI Panels

Flash uses the `io.modelcontextprotocol/ui` extension. All 7 panel tools are absent from Skola.

| Flash Tool | Skola Equivalent | Gap |
|---|---|---|
| `panel_cards` | None | ❌ Missing: returns cards formatted for generative UI card carousel |
| `panel_show_answer` | None | ❌ Missing: returns back HTML for display inside chat widgets |
| `panel_grade` | None | ❌ Missing: handles 1-4 rating button clicks from UI panels |
| `panel_edit_source` | None | ❌ Missing: supplies raw note fields for inline modal editing |
| `panel_save_edit` | None | ❌ Missing: commits in-place edits from chat widgets |
| `panel_archive` | None | ❌ Missing: archives/unarchives the **card** (not deck) from within a session; card is removed from future study until unarchived; undo restores it to front of queue |
| `panel_reminders` | None | ❌ Missing: saves reminder preferences from panel prompts |

**Flash panel protocol**: Tools carry `_meta["flash/panel"]` with `component`, `props`, and `actions`. Tools are tagged `["app"]` (panel-only), `["model"]` (AI-only), or both. Skola has no equivalent mechanism yet.

### 3.6 Advanced Features (Skola++ Exclusive)

These have no Flash equivalent and represent Skola++'s structural advantage:

| Skola++ Tool | Description |
|---|---|
| `find_leeches` | Identifies cards with ≥N lapses; tagged or high-lapse sort |
| `find_similar_cards` | Semantic similarity via word stems + trigrams (0.5–1.0 score), no AI needed |
| `create_master_card` / `update_master_card` / `master_coverage` | Concept hierarchy with per-entry card links; auto-generates study cards |
| `create_objective` / `record_assessment` / `get_objective_overview` | K/S mastery tracking with 4 K-dimensions × 4 S-dimensions, dated evidence |
| `get_card_image` | Image occlusion area coordinates and 1-hour signed image URL |
| `get_skill` / `create_skill` / `update_skill_file` / `skill_history` | Full dynamic agent skills registry with version control |
| `deck_schedule` | 1–30 day forecast: overdue, per-day, avg stability/difficulty |
| `set_card_schedule` | Manual bury/unbury/set_due/reset/set_override per card |
| `get_card_details` | Full FSRS state + recall-now calculation + complete review log |
| `list_presets` / `update_preset` | Named preset management with all 15 FSRS parameters |
| `next_card` | Skip/re-fetch safely without grading |
| `suggest_master_rating` | Computed from linked card FSRS states (reference only) |

---

## 4. AI Skills Comparison

### 4.1 Flash: Static System Prompt

Flash delivers a single static instruction block at `initialize` handshake. Source: `flash-ref/mcp/instructions.md`.

Key elements:
- **Grading rubric** (embedded directly in `submit_review.json`): *"Grade STRICTLY against the card's back: facts, numbers, doses, and units must match precisely. An imprecise answer is 1 (Again), never 'close enough'."*
- Single generic assistant persona
- No specialized sub-agents
- No user customization

### 4.2 Skola++: 5 Dynamic Skills

Skola++ delivers dynamic `serverInstructions` and 5 specialized skills loaded on demand:

| Skill | Description | Purpose |
|---|---|---|
| `skola` | Core router | Dispatch table + 6 protection rules + master card protocol |
| `skola-active-learning-tutor` | Tutoring persona | 8-step cycle: diagnose → retrieve → explain → discriminate → apply → transfer → assess → schedule |
| `skola-card-architect` | Card design persona | Objectives-first, source-traced, duplicate-checked card authoring with 10 quality gates |
| `skola-deck-maintainer` | Maintenance persona | Dedup, leech repair, retag, reorganize — with master card coverage preservation |
| `skola-quality-auditor` | Auditing persona | Read-only evidence verification, mastery validation, coverage check |

**Gap:** Skola's grading guidance lives in `references/quizzing.md` inside the `skola` skill. It is correct but not embedded in `submit_review`'s tool description. Flash's rubric fires every time the tool is called, regardless of whether the AI read the skill. Skola should add a short grading note directly in the `submit_review` description field.

**Skola++ advantage:** Dynamic per-user instructions (`get_instructions` / `set_instructions`), skills stored in Postgres with version history, `SKILL_ADMINS` for default skill editing, skill discovery via `/skills/llm.txt`.

---

## 5. Architecture Comparison

### 5.1 Authentication

| Dimension | Flash | Skola++ | Gap |
|---|---|---|---|
| Primary auth | WebAuthn/passkeys (FIDO2 + resident keys) | Email + password (bcrypt) | ❌ Skola has no passkey support |
| OAuth | OAuth 2.1 with PKCE S256 | OAuth 2.1 with opaque tokens (ADR 0005) | ⚠️ PKCE S256 not confirmed in Skola |
| Tokens | Rotating refresh tokens (RT rotated on each use, old RT revoked) | Opaque session tokens (non-rotating) | ⚠️ Skola has no token rotation |
| Multi-user invite | Admin invite system (email invite → passkey registration) | ALLOW_SIGNUP env var (open or closed) | ⚠️ No invitation flow |
| MFA | WebAuthn is inherently phishing-resistant MFA | None | ❌ |

### 5.2 Data Storage

| Dimension | Flash | Skola++ | Notes |
|---|---|---|---|
| Primary DB | SQLite (single file, WAL mode) | Dexie IndexedDB (client) + Postgres (Supabase) | Skola is local-first; Flash is server-authoritative |
| ORM | Custom SQL builder (Rust) | Drizzle (server) + Dexie (client) | |
| Card versions | 20 versions / 90 days | 7 days | ❌ Flash has 3× longer history |
| Media storage | Content-addressed (SHA256 hash as filename) + magic byte validation | Cloudflare R2 with UUID filenames | ⚠️ Flash is more robust against corruption |
| Media types | PNG, JPEG, WebP, GIF, SVG + audio (voice clips) | PNG, JPEG, WebP, GIF | ❌ No audio/SVG support |

### 5.3 FSRS Scheduling

| Dimension | Flash | Skola++ |
|---|---|---|
| Algorithm | FSRS v6 (Rust `fsrs` crate 6.6.1, `FSRS6_DEFAULT_DECAY`) | FSRS-6 (ts-fsrs) + policy overlay |
| Goal-date pacing | Built-in: computes daily target from `exam_date` and card count | Via `exam_date` + `exam_buffer_days` + `exam_ramp` on preset |
| Fuzz | Yes | Yes (`enable_fuzz`) |
| Personal weights | Stored per-deck | Stored per-preset |
| New-card order | Random or due-date | Added/due order per preset |
| Review cap | Via `get_limits` / `set_limits` | Via preset `max_reviews_per_day` |

### 5.4 Import / Export

| Feature | Flash | Skola++ | Gap |
|---|---|---|---|
| Anki .apkg import | ✅ Two-step (preview→commit), 100 MB max, HTML sanitized, suspension preserved, revlog replay (`progress` option), 4 note types mapped | ❌ None | ❌ Critical missing feature |
| Anki .apkg export | ✅ Scheduling reset to 0 (all cards "new" in Anki), HTML preserved, media rewritten, cloze round-trip via `cloze_text` | ❌ None | ❌ |
| CSV import | ✅ `front`, `back`, optional `tags`, optional `deck` path; plain text; semicolon- or comma-separated tags | ❌ None | ❌ Missing |
| JSON export | ❌ | ❌ | Both missing |

### 5.5 Voice & Speech

| Feature | Flash | Skola++ | Gap |
|---|---|---|---|
| `front_speech` / `back_speech` JSON arrays | ✅ `{lang, text}` or `{say: "equation"\|"look"\|"blank"}` | ❌ Plain text only | ❌ |
| TTS audio clips | ✅ Stored per-card voice clip (SHA256), served as `/audio/:hash` | ❌ | ❌ |
| Voice assistant compatibility | ✅ Audio cues prevent reading LaTeX aloud | ❌ | ❌ |

### 5.6 Web UI Routes

| Flash | Skola++ |
|---|---|
| `/` Home / dashboard | `/#/home` |
| `/decks` Deck list | `/#/decks` |
| `/decks/:id` Deck detail | `/#/deck/:id` |
| `/cards` Card browser | `/#/notes` |
| `/study` Study (MCP mirror) | `/#/learn/:id` |
| `/settings` User settings | `/#/settings` |
| `/settings/skills` Skills editor | `/#/settings/skills` |
| `/import` Anki import | ❌ Missing in Skola++ |
| `/export` Anki export | ❌ Missing in Skola++ |
| N/A | `/#/master/:noteId` Master builder |
| N/A | `/#/graph` Knowledge graph |
| N/A | `/#/objectives` K/S objectives |

---

## 6. Gap Prioritization Matrix

Gaps ranked by user impact × implementation feasibility:

| Priority | Gap | Impact | Effort | Phase |
|---|---|---|---|---|
| P0 | `boost_new_today` / `get_limits` / `set_limits` MCP tools | High: exam pacing UX | Low | 16.1 |
| P0 | `archive_deck` / `unarchive_deck` (recursive) | High: deck hygiene | Low | 16.1 |
| P0 | `rename_deck` with `Parent::Child` re-parenting | High: reorganization | Low | 16.1 |
| P0 | `Parent::Child` path syntax in `create_deck` and `add_cards` | High: AI card creation ergonomics | Medium | 16.1 |
| P0 | Strict grading note in `submit_review` description | High: prevents AI leniency | Trivial | 16.1 |
| P0 | `archived: boolean` in `list_decks` output | Medium: required for archive tools | Trivial | 16.1 |
| P1 | `tags: string[]` multi-tag AND filter in `start_study_session` | High: targeted study | Low | 16.2 |
| P1 | `basic_typed` note type | Medium: code/formula/spelling | Medium | 16.2 |
| P1 | `front_speech` / `back_speech` speech blocks | High: voice assistant users | Medium | 16.2 |
| P1 | Card history extended: 7 days → 90 days / 20 versions | Medium: recovery | Medium | 16.2 |
| P2 | MCP UI panel tools (7 `panel_*` endpoints) | High: clients that support `io.modelcontextprotocol/ui` | High | 16.3 |
| P2 | Anki .apkg import | High: migration path from Anki | Very High | 17 |
| P2 | Anki .apkg export | Medium: backup / portability | High | 17 |
| P3 | WebAuthn / passkeys | High: security | Very High | 18 |
| P3 | Rotating refresh tokens | Medium: security hardening | Medium | 18 |
| P3 | Content-addressed media (SHA256) | Medium: data integrity | Medium | 18 |
| P3 | Audio voice clip storage | Low: TTS edge cases | High | 18 |
| P3 | Admin invite flow | Low: multi-tenant | Medium | 19 |

---

## 7. Phase-by-Phase Implementation Plan

### Phase 16.1 — Deck Ergonomics & Pacing (Backend MCP)

**Target:** Close all P0 gaps. Zero UI changes. All in `src/server/`.

#### 16.1.1 `resolveDeckPath` Helper

**File:** `src/server/mcpManage.ts` (new export at top)

```typescript
export async function resolveDeckPath(
  userId: string,
  input: string,
  createMissing?: boolean
): Promise<{ id: string }> {
  // If UUID, return directly
  // Otherwise split by "::" or " / " into segments
  // Walk existing decks by name + parent chain
  // If createMissing=true, batch-create missing ancestors
}
```

Accepts UUID or `"Medicine::Cardiology"` or `"Medicine / Cardiology"`. Used by all tools below.

#### 16.1.2 `boost_new_today` / `get_limits` / `set_limits`

**File:** `src/server/mcpLimits.ts` (new file)

`boost_new_today`:
- Input: `{ deck?: string | null, extra: integer 1–500 }`
- Storage: synced user setting `#dailyBoosts: { date: string, accountExtra: number, deckExtras: Record<string, number> }`
- Resets when logical day changes (compare `date` against `nextDayStartTime`, default 4 AM user local time)
- Output: `{ deck, extra, total_new_today, resets_at }`

`get_limits`:
- No input
- Reads: account preset defaults + per-deck overrides + boost record
- **Skola note:** review logs sync to the server (pushed by `reviewedAt`), so `get_limits` can count today's reviews from them. The count is only as fresh as each device's last sync; report that in the output rather than hiding it.
- Output:
  ```json
  {
    "account_defaults": { "new_per_day": 20, "reviews_per_day": 200, "extra_today": 0 },
    "decks": [{
      "id": "...", "path": "Medicine / Cardiology",
      "new_per_day": null, "reviews_per_day": null,
      "goal_date": null
    }]
  }
  ```

`set_limits`:
- Input: `{ deck?: string | null, new_per_day?: integer | null, reviews_per_day?: integer | null, goal_date?: string | null }`
- Passing `-1` clears deck-specific override, falls back to account defaults
- Setting `goal_date` updates `exam_date` on the named deck
- Resolves deck by name or UUID via `resolveDeckPath`
- **Skola constraint:** `set_limits` is a convenience wrapper — it updates the deck's assigned preset (or creates a one-off deck-level override). It does NOT bypass Skola's preset system; preset management tools (`list_presets`, `update_preset`) remain the full-featured path for all 15 FSRS parameters.

#### 16.1.3 `archive_deck` / `unarchive_deck`

**File:** `src/server/mcpManage.ts`

`archive_deck`:
- Input: `{ deck: string }` (name or UUID)
- Finds target + all descendant decks via recursive CTE or in-memory tree walk
- Sets `archivedAt = now()` and `priority = "paused"` on all
- `start_study_session`, `get_due_cards`, `deck_stats` exclude archived decks
- Output: `{ archived: true, decks_affected: N, path: "..." }`

`unarchive_deck`:
- Input: `{ deck: string }`
- Clears `archivedAt` and resets `priority = "normal"` on target + ancestors that were archived as part of this tree
- Output: `{ unarchived: true, decks_affected: N }`

Requires Dexie schema change: add `archivedAt?: number` to `DeckTable` (new Dexie version). Add Postgres column `archived_at timestamptz` to `decks` table (new migration). Add to sync tracking.

#### 16.1.4 `rename_deck`

**File:** `src/server/mcpManage.ts`

- Input: `{ deck: string, new_name: string }`
- Parses `new_name`: if it contains `::` or `/`, treat as `Parent::Child` path
- Re-parents by updating `parent_id` (and preventing cyclic references)
- If parent segment missing, creates it via `resolveDeckPath(createMissing: true)`
- Output: `{ ok: true, id, name, parent_id }`

#### 16.1.5 `Parent::Child` path support

**File:** `src/server/mcpManage.ts` (`create_deck`) and `src/server/mcpNotes.ts` (`add_cards`)

- `create_deck`: accept `name: "Parent::Child"` as alternative to explicit `parent_id`
- `add_cards`: accept `deck: "Parent::Child"` string in addition to `deck_id` UUID
- Both route through `resolveDeckPath(createMissing: true)`

#### 16.1.6 `archived` flag in `list_decks`

Add `archived: boolean` to `list_decks` output (derived from `archivedAt !== null`).

#### 16.1.7 Grading note in `submit_review`

Add to `submit_review` description:
> "Grade strictly: facts, numbers, units, and spelling must match the answer. An imprecise or close-but-wrong answer is 1 (Again), not 2. Only use 3 or 4 when the answer was actually correct."

**Files changed:** `src/server/mcpStudy.ts`, `src/server/mcpManage.ts` (new tools), `src/server/mcpLimits.ts` (new file), `src/server/mcp.ts` (register new tools), `src/logic/db.ts` (new Dexie version), `supabase/migrations/YYYYMMDD_archive_deck.sql`.

**Tests:** `src/server/mcpLimits.test.ts`, `src/server/mcpManage.test.ts` additions (all PGlite).

---

### Phase 16.2 — Study & Note Enhancements

#### 16.2.1 Multi-tag AND filter in `start_study_session`

**File:** `src/server/mcpStudy.ts`

Extend `inputSchema`:
```typescript
tags: { type: "array", items: { type: "string" }, description: "AND-filter: only include cards whose note has ALL these tags" }
```

In `pickNext` and `snapshot`: filter candidate cards by checking `note.tags` contains every element of `tags[]`.

#### 16.2.2 `basic_typed` note type

**File:** `src/logic/type-implementations/basic_typed.ts` (new)

Fields: `front: string`, `back: string`, `case_sensitive: boolean` (default false).

Study behavior:
- `show_answer` returns `answer` with `grading_mode: "verbatim"`
- `submit_review` description notes: "Compare learner's exact string against `back`; punctuation and whitespace are trimmed; case sensitivity per `case_sensitive` flag; edit distance is returned for reference but does not affect FSRS scheduling"
- MCP adds `grading_mode: "verbatim"` to `show_answer` response when card type is `basic_typed`

**Files:** new type file, `src/logic/type-implementations/index.ts`, `add_cards` schema, `edit_card` schema, `show_answer` response type.

#### 16.2.3 Speech blocks

**File:** `src/server/mcpNotes.ts`

```typescript
type SpeechBlock = { lang: string; text: string } | { say: "equation" | "look" | "blank" };
```

Add optional `front_speech?: SpeechBlock[]` and `back_speech?: SpeechBlock[]` to:
- `add_cards` schema (all card types except image_occlusion)
- `edit_card` schema

Storage: `note.content.front_speech` / `note.content.back_speech` JSON arrays. No DB migration needed (stored in existing JSON `content` column).

MCP tools return them in card view when present so voice assistants can consume them.

#### 16.2.4 Card history: 90 days / 20 versions

**File:** `src/server/mcpManage.ts`, `src/server/pg.ts` (or wherever history TTL is defined)

Change `keeps_days` from 7 → 90. Change max versions from unlimited → 20 per note (prune oldest when inserting beyond 20).

Requires Postgres migration: `ALTER TABLE note_versions ADD COLUMN IF NOT EXISTS version_num integer;` and prune trigger or application-level pruning.

---

### Phase 16.3 — MCP UI Panel Bridge

**File:** `src/server/mcpPanel.ts` (new file)

Implements the `io.modelcontextprotocol/ui` extension protocol. All 7 panel tools are tagged `annotations: { audience: ["app"] }` (visible to UI clients, hidden from plain AI).

#### Panel protocol

Tool results carry:
```json
{
  "_meta": {
    "skola/panel": {
      "component": "CardCarousel",
      "props": { "cards": [...] },
      "actions": [
        { "id": "grade_1", "label": "Again", "tool": "panel_grade", "args": { "rating": 1 } }
      ]
    }
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

#### Tools

1. **`panel_cards`** — Returns current session card(s) formatted for the card carousel widget. Input: `session_id`. Output: card HTML + grade action buttons.
2. **`panel_show_answer`** — Returns back HTML. Input: `session_id, card_id`. Output: answer HTML.
3. **`panel_grade`** — Handles rating button click. Input: `{ session_id, card_id, rating: 1|2|3|4, answer_ms?: number, ui_locale?: string }`. `answer_ms` is response-time telemetry: milliseconds from card front display to grade button press. Stored for future learning analytics. Calls `submit_review` internally. Returns `PanelOut` with next card prefetched.
4. **`panel_edit_source`** — Returns raw note fields for modal edit. Input: `card_id`. Output: note fields object.
5. **`panel_save_edit`** — Commits edit from panel modal. Input: `card_id, fields`. Calls `edit_card` internally.
6. **`panel_archive`** — Archives or unarchives a **card** (not a deck) from within a study session. Input: `{ session_id, card_id, archived: boolean }`. Calls `set_card_archived(user, card, archived, now)` internally. When set archived=true, card is removed from study queue; undo (archived=false from the same panel action) restores it to the front of the queue. This is a "quiet retire this specific card" action, distinct from `archive_deck`.
7. **`panel_reminders`** — Saves daily reminder preference. Input: `time: "HH:MM"`, `days: number[]`. Stored in Dexie synced user settings as `#reminderConfig` (synced to other devices). No new server table — this is a user preference, not server state.

#### Signed media URLs for panel content

Panel responses reference card media (images, audio) via short-lived signed URLs. Flash uses HMAC-SHA256 with a 24-hour TTL, key stored in DB at first use (`server_state_or_insert("panel_media_key")`). URLs are rewritten from internal storage paths to signed `/mcp-media/{id}/s?e={expiry_ms}&s={sig}` routes.

Skola++ spec: add `GET /api/mcp-media/[id]/s` route. On first panel tool call, generate a 32-byte random signing key and store in DB `server_state` table. Sign media URLs with HMAC-SHA256(`key`, `${id}:${expiry_epoch_ms}`). Return these signed URLs in `preload` and card HTML. Reject requests where signature doesn't match or `e` has passed.

**Files:** `src/server/mcpPanel.ts`, `src/server/mcp.ts` (register), `app/api/mcp-media/[id]/s/route.ts` (signed media proxy), `supabase/migrations/YYYYMMDD_server_state.sql`. No `reminder_config` migration — reminders go in Dexie synced settings.

**Tests:** `src/server/mcpPanel.test.ts` (simulated MCP client callback flow).

---

### Phase 17 — Anki Import / Export (optional, later)

> Not gap-closing: this is a separate product feature. Do it only after Phases 16 and 20, and only if the owner wants it.

This is the highest-effort single gap. Flash's implementation is Rust + `zip` + `rusqlite`. Skola's would be TypeScript + `jszip` + `sql.js` (SQLite in WASM).

#### 17.1 Import pipeline

**File:** `app/api/import/anki/route.ts` (new server route)

Two-step flow (matching Flash's approach): preview → commit. Preview parses the .apkg and parks it on disk with a 2-hour TTL token. Commit applies choices.

Steps:
1. Accept `.apkg` file upload (multipart, max 100 MB Vercel limit)
2. Unzip with `jszip`: extract `collection.anki21` (SQLite) and `media` JSON map
3. Open SQLite in-memory with `sql.js`
4. Map Anki 21 schema → Skola note types:
   - `Basic` → `basic`
   - `Basic (and reversed card)` → `reverse`
   - `Cloze` → `cloze`
   - Others → `basic` (best-effort HTML strip)
5. Preview response: `{ token, decks, note_count, card_count, media_count, unsupported_types }`

Commit options (sent with token):
```typescript
interface AnkiCommitOptions {
  token: string;
  deck?: string;           // override root deck name
  keep_decks: boolean;     // preserve Anki deck structure (default true)
  progress: boolean;       // replay Anki review history into FSRS log (default false)
  settings: boolean;       // adopt Anki FSRS settings if present (default false)
  clean_colors: boolean;   // strip color tags from card HTML (default false)
}
```

`progress: true` replays Anki review records from `revlog` table into Skola's review log. This preserves scheduling state so FSRS doesn't treat imported cards as new. Without it, all imported cards start fresh.

6. Stream-create decks and notes via existing server functions
7. Upload media to R2, update note `content` with new URLs
8. Return `{ imported: { decks, notes, cards, media }, skipped: [...] }`

**UI:** New route `/#/import` with file drop zone, preview summary (deck tree, counts), options checkboxes (keep_decks, progress, clean_colors), commit button.

#### 17.2 Export pipeline

**File:** `app/api/export/anki/route.ts`

Steps:
1. Query all user notes + cards + decks + review logs
2. Build Anki 21 SQLite schema in-memory via `sql.js`
3. Download R2 media, add to zip
4. Stream zip response with `Content-Disposition: attachment; filename=skola-export.apkg`

**UI:** Export button on `/#/settings` page.

---

### Phase 18 — Security & Auth Hardening (optional, later)

> Not gap-closing: this is a separate product feature. Do it only after Phases 16 and 20, and only if the owner wants it.

#### 18.1 WebAuthn / Passkeys

**File:** `src/server/auth.ts`, `app/(auth)/` pages

Add WebAuthn registration and authentication alongside existing email+password. Use `@simplewebauthn/server` (Node) + `@simplewebauthn/browser` (client). Users can register multiple passkeys; email+password remains as fallback.

New Postgres tables: `webauthn_credentials(id, user_id, credential_id, public_key, counter, device_type, created_at)`.

#### 18.2 Rotating refresh tokens

**File:** `src/server/oauth.ts`

On each token refresh:
1. Generate new refresh token
2. Revoke old refresh token (set `revoked_at`)
3. If old token already revoked → revoke all sessions for that user (replay attack detection)

Requires migration: add `revoked_at timestamptz` to `oauth_tokens` table.

#### 18.3 Content-addressed media

**File:** `src/server/media.ts` (new), replaces ad-hoc R2 upload logic

On upload:
1. Read first 12 bytes for magic byte validation (PNG: `\x89PNG`, JPEG: `\xFF\xD8`, WebP: `RIFF...WEBP`, GIF: `GIF8`)
2. Compute SHA256 of file body
3. Key = `media/{userId}/{sha256}.{ext}` — identical content deduplicates automatically
4. Store mapping `media_assets(sha256, r2_key, user_id, size, mime, created_at)`

Existing R2 uploads remain valid; new uploads use content-addressed scheme.

---

### Phase 19 — Multi-user Invite & Admin (optional, later)

> Not gap-closing: this is a separate product feature. Do it only after Phases 16 and 20, and only if the owner wants it.

**File:** `app/api/invite/route.ts`, `src/server/auth.ts`

Admin (SKILL_ADMINS or new ADMIN_EMAILS env var) can POST `/api/invite` with an email. System sends a one-time invite token. Recipient signs up with that token (or registers a passkey if Phase 18 is done).

Postgres: `invites(id, token_hash, email, invited_by, created_at, used_at)`.

---

## 8. Skola++ Superiority Checklist

After all phases complete, Skola++ exceeds Flash on every dimension:

| Dimension | Flash | Skola++ after Phases 16–19 |
|---|---|---|
| MCP tools | 26 | 63+ (56 existing + 7 panel + limits + archive tools) |
| AI skills | 1 static | 5 dynamic, versioned, user-customizable |
| Card types | 4 (Basic, BasicReversed, BasicTyped, Cloze) | 8 (basic, basic_reversed, basic_typed, cloze, multiple_choice, list, image_occlusion, master) |
| Learning evidence | None | K/S 4×4 dimension mastery tracking |
| Master cards | None | Concept hierarchy with per-entry card links |
| Semantic dedup | None | Threshold-based stem+trigram similarity |
| Schedule forecast | None | 1–30 day per-deck forecast |
| Knowledge graph | None | Obsidian-style force-directed graph |
| FSRS version | v6 (fsrs crate 6.6.1) | v6 (ts-fsrs) — algorithm parity; differences are in policy and UX |
| Auth | WebAuthn + OAuth 2.1 PKCE S256 | email+password + WebAuthn + rotating refresh tokens |
| Media | Content-addressed SHA256 | Content-addressed SHA256 (after Phase 18) |
| Import/Export | Anki .apkg | Anki .apkg (after Phase 17) |
| Speech blocks | ✅ | ✅ (after Phase 16.2) |
| UI panels | ✅ | ✅ (after Phase 16.3) |
| Offline-first | ❌ server-authoritative | ✅ Dexie IndexedDB PWA |
| Deployment cost | Self-hosted Rust binary | Vercel + Supabase free tier |
| Open source | Unknown | AGPL-3.0 |

---

## 9. AI-First UX Patterns — Deep Source Analysis

> This section is based on direct reading of Flash's Rust source code (`crates/flash-server/src/mcp/`). It documents the behavioral patterns that make Flash's MCP experience feel AI-native, and specifies exactly what Skola++ must add to match and exceed them.

---

### 9.1 `grading_mode` — Per-Session Behavior Configuration

**Flash source:** `study_tools.rs:199–214` (`grading_instruction` fn)

Flash stores a `grading_mode` in account settings and returns it on every `start_study_session` response. The AI must follow it for the **entire session**:

| Mode | Instruction to AI |
|---|---|
| `silent` | "never mention ratings, intervals, or scheduling; confirm correctness naturally and continue" |
| `announce` | "state your rating in one word after each answer; if the user corrects it, resubmit with their rating" |
| `self_grade` | "after revealing whether they were right, ask the user to rate the card 1-4 and submit their rating" |

This is a **user-configurable grading experience**. Different learners prefer different interaction styles. Some want the AI to be invisible about scheduling; others want to self-grade; others want the AI to announce its rating and accept corrections.

**Skola++ gap:** No `grading_mode`. The AI always behaves the same way regardless of user preference.

**Spec for Skola++:**

Add `grading_mode` to user settings (synced `#gradingMode: "silent" | "announce" | "self_grade"`). Return it in `start_study_session`:

```typescript
// In mcpStudy.ts - start_study_session response
grading_mode: gradingInstruction(user.settings.gradingMode)
```

```typescript
function gradingInstruction(mode: "silent" | "announce" | "self_grade"): string {
  switch (mode) {
    case "silent": return "silent: never mention ratings, intervals, or scheduling; confirm correctness naturally and continue";
    case "announce": return "announce: state your rating in one word after each answer; if the user corrects it, resubmit with their rating";
    case "self_grade": return "self: after revealing whether they were right, ask the user to rate the card 1-4 and submit their rating";
  }
}
```

Add a Settings > Study tab picker for grading mode. Default: `"silent"` — matching Flash's actual default (`GradingMode::Silent` is `#[default]` in `settings.rs`). Silent keeps scheduling invisible; users can opt into announce or self_grade.

**Skola note:** `grading_mode` is a session-level UX preference, not an assessment framework. Skola's K/S objectives system (Phase 12) handles multi-dimensional mastery tracking with dated evidence. These two are complementary — `grading_mode` governs how the AI narrates a study session; K/S governs competency measurement.

---

### 9.2 `note` — Dynamic AI Guidance in Tool Responses

**Flash source:** `study_tools.rs:38–83` (`queue_note` fn), `card_tools.rs:61–85` (`CARDS_SHOWN`, `on_the_site`)

Flash generates **plain-language guidance for the AI** as a `note` field on session responses. This is not shown to the user — it is an AI instruction embedded in the tool result. It tells the AI exactly what to say and what to do next.

#### 9.2.1 `queue_note` — 4-state empty queue guidance

When a session queue is empty, `start_study_session` and `submit_review` return a `note`:

| State | `note` content |
|---|---|
| **No cards at all, no scope** | "The user has no cards yet. Ask what they are studying and offer to make their first cards: from notes, slides or a file they share, a topic they name, or this conversation. Write them with create_cards once they say what to cover (never cards they did not ask for), then offer a short session with start_study_session. Cards asked from the conversation are not recorded." |
| **No cards in this deck/tag** | "Nothing to study: no card is in this deck or carries these tags. Tell the user, and offer to make cards for it from their notes, a file or a topic, written with create_cards once they say what to cover. Cards asked from the conversation are not recorded." |
| **Held by daily limit** | "Queue empty for now, but N more card(s) are held back by today's daily limit (new cards per day, default 20). Tell the user they've finished today's allowance and that N remain; if they want to keep going, call boost_new_today (with this deck's name if the session was deck-scoped) and then start_study_session again. The next cards come tomorrow (5); say so. Cards asked from the conversation are not recorded." |
| **Caught up** | "Nothing to study right now: every card in scope comes back later. Tell the user they're caught up. The next cards come tomorrow (5); say so. Cards asked from the conversation are not recorded." |

The critical constant `ONLY_SESSIONS_COUNT = "Cards asked from the conversation are not recorded."` appears in every empty-queue note. This prevents the AI from improvising "quiz questions" in the conversation that don't update FSRS.

#### 9.2.2 `create_cards` response note

After creating cards, if the panel is showing:
- Note = "The user sees these cards in Flash's panel, so a one-line confirmation (how many, which deck) is enough; there is no need to list or restate them. The cards are saved in the user's Flash account, where they can also study them any time: https://..."

If no panel:
- Note = "The cards are saved in the user's Flash account, where they can also study them any time: https://..."

This prevents verbose card-listing in the AI response when the panel already shows them.

#### 9.2.3 `end_session` response note

Always: "The cards come back when they are due; the user can study them any time in their Flash account: https://[site]/study"

This converts every session end into an implicit CTA to the web product.

#### 9.2.4 `list_decks` response note

When account has zero cards: returns `OFFER_FIRST_CARDS` note — same text as above. This means even a simple "list my decks" call converts to a card-creation flow when the account is empty.

**Skola++ spec:**

Add `note?: string` to responses of:
- `start_study_session` — with `queue_note()` logic + `ONLY_SESSIONS_COUNT`
- `submit_review` — same `queue_note()` when `done: true`
- `end_session` — with site URL CTA
- `add_cards` — with panel-conditional terse confirmation
- `list_decks` — with `OFFER_FIRST_CARDS` when no cards

```typescript
// In mcpStudy.ts
const ONLY_SESSIONS_COUNT = "Cards asked from the conversation are not recorded.";
const OFFER_FIRST_CARDS = "The user has no cards yet. Ask what they are studying and offer to make their first cards: from notes, slides or a file they share, a topic they name, or this conversation. Write them with add_cards once they say what to cover (never cards they did not ask for), then offer a short session with start_study_session. " + ONLY_SESSIONS_COUNT;

function queueNote(params: {
  inQueue: number;
  heldByLimit: number;
  hasCards: boolean;
  scoped: boolean;
  nextDue?: { in_days: number; cards: number };
}): string | undefined {
  if (params.inQueue > 0) return undefined;
  const nextLine = params.nextDue
    ? ` The next cards come ${whenWords(params.nextDue.in_days)} (${params.nextDue.cards}); say so.`
    : "";
  if (!params.hasCards && params.heldByLimit === 0) {
    return params.scoped
      ? `Nothing to study: no card is in this deck or carries these tags. Tell the user, and offer to make cards for it from their notes, a file or a topic, written with add_cards once they say what to cover. ${ONLY_SESSIONS_COUNT}`
      : `${OFFER_FIRST_CARDS} ${ONLY_SESSIONS_COUNT}`;
  }
  if (params.heldByLimit > 0) {
    return `Queue empty for now, but ${params.heldByLimit} more card(s) are held back by today's daily limit. Tell the user they've finished today's allowance and that ${params.heldByLimit} remain; if they want to keep going, call boost_new_today and then start_study_session again.${nextLine} ${ONLY_SESSIONS_COUNT}`;
  }
  return `Nothing to study right now: every card in scope comes back later. Tell the user they're caught up.${nextLine} ${ONLY_SESSIONS_COUNT}`;
}
```

---

### 9.3 `submit_review` Returns `next_card` Directly

**Flash source:** `study_tools.rs:382–395` (`SubmitOut`)

Flash's `submit_review` returns `next_card: Option<CardFrontOut>` — the next card's front HTML is included in the same response. The AI gets question + card_id in one round trip and can immediately display it.

Skola's `submit_review` returns `next: { done, card_id, type, question, ... }` which includes `question` — this is structurally equivalent. **No gap here, but verify the field naming is consistent.**

---

### 9.4 `comes_back_in_ms` — Preview Intervals on `show_answer`

**Flash source:** `out.rs:200–206` (`PanelAnswerOut`)

Flash's `panel_show_answer` returns:
```json
{
  "comes_back_in_ms": [600000, 86400000, 259200000, 604800000]
}
```

The 4 values are Again/Hard/Good/Easy intervals in ms. The panel shows these on the grade buttons: "Again → 10 min", "Hard → 1 day", "Good → 3 days", "Easy → 7 days".

This is transformative UX: the user knows the consequence of each rating BEFORE they press the button.

**Skola++ spec:**

Add `comes_back_in_ms?: [number, number, number, number]` to `show_answer` response (and to the panel equivalent). Compute by running the FSRS scheduler's `preview` function for all 4 ratings without committing:

```typescript
// In mcpStudy.ts - show_answer
const card = await getCard(cardId);
const previewIntervals = [1, 2, 3, 4].map(rating =>
  previewNextInterval(card, rating) // runs FSRS without committing
);
return {
  question, answer,
  comes_back_in_ms: previewIntervals as [number, number, number, number],
  next_step: "...",
};
```

This requires a `previewNextInterval(card, rating)` pure function in `src/logic/scheduling/policy.ts` that runs `scheduleCard` logic without writing to Dexie.

---

### 9.5 Panel Prefetch and Optimistic UI

**Flash source:** `out.rs:97–151` (`PanelOut`)

Flash's panel protocol includes:
- `next_card: Option<PanelCardOut>` — the next card's front is fetched BEFORE the user grades, so it can be shown **instantly** when a grade button is tapped
- `preload: Vec<String>` — signed URLs for this card's back and next card's front that the panel pre-fetches to warm the cache
- `state: "card" | "held" | "caught_up" | "empty"` — drives entirely different panel views

The "held" state offers a "Study N more" button that calls `boost_new_today` then `start_study_session` without an extra AI round-trip. The panel handles this directly.

**Skola++ spec for panel tools** (Phase 16.3):

The `PanelOut` structure for `panel_*` tools must include:
```typescript
interface PanelOut {
  view: "study";
  session_id: string;
  state: "card" | "held" | "caught_up" | "empty";
  card?: PanelCardOut;        // current card front HTML
  next_card?: PanelCardOut;   // prefetched next card front
  remaining: number;
  reviewed: number;
  held_by_limit: number;
  preload: string[];          // URLs to warm
  recorded: boolean;          // false if panel_grade found already-graded card
  next_due?: { at_ms: number; in_days: number; cards: number };
  week?: { at_ms: number; cards: number }[];  // 7 days ahead
  reminders_offer: boolean;
  site_url: string;
}
```

The `recorded: false` case in `panel_grade` is important: if the AI already graded the card in chat, the panel button does not double-record it. The panel just returns the current state.

---

### 9.6 Speech Blocks — Optional in Schema

**Flash source:** `args.rs:235–249` (`speech_fields_required` transform)

Flash marks `front_speech` and `back_speech` as **required** in its JSON Schema. This forces every AI to generate speech blocks for every card.

**Skola decision: keep speech blocks optional.**

Flash is voice-first by product design. Skola is not. Making speech blocks required forces every card-creation call to include speech arrays regardless of whether the user has a voice assistant. This adds friction with no benefit for the majority of users.

Speech blocks in Skola are **optional** fields in `add_cards` and `edit_card`. Users who want voice-ready cards by default can configure the `skola-card-architect` skill to always include them. Voice-first users can set a custom AI instruction to require them.

```typescript
// In mcpNotes.ts - add_cards inputSchema — speech is optional
{
  "type": "object",
  "properties": {
    "front_speech": {
      "description": "Optional speech blocks for voice assistants. Include only when the user has a voice context or requests it.",
      "type": "array",
      "items": { "oneOf": [{"$ref": "#/$defs/SayBlock"}, {"$ref": "#/$defs/CueBlock"}] }
    },
    "back_speech": { ... }
  },
  "required": ["deck_id", "cards"]  // ← speech is NOT required
}
```

---

### 9.7 Tool Descriptions as Conversational Guides

Flash's tool descriptions are not documentation — they are **conversational routing instructions** that tell the AI when and how to use each tool.

Compare:

| Flash `start_study_session` description | Skola `start_study_session` description |
|---|---|
| "Use this when the user wants to study, review, practice, be quizzed on or drill their flashcards, **including cards made moments ago**. ... Returns the first card's front (**ask it and wait for the user's answer**), how many cards are due, and grading_mode. **Render front_html for display or interpret it for speech; present cloze gaps without revealing answers, and never read raw markup or URLs aloud.** ... **Follow grading_mode for the whole session. Internal fields (ids, counts) are never read aloud.**" | "Start a study session and get the first card" |

| Flash `show_answer` description | Skola `show_answer` description |
|---|---|
| "Use this when the user **gives up on the card just asked** in a study session, or **asks for its answer**. Returns the card's back and records nothing: **tell the user the answer, then call submit_review with rating 1 (Again)**." | "Reveal the answer of the card being asked" |

| Flash `submit_review` description | Skola `submit_review` description |
|---|---|
| "Use this after the user answers the card just asked in a study session: ... **Grade STRICTLY against the card's back: facts, numbers, doses, and units must match precisely. An imprecise answer is 1 (Again), never 'close enough'; only phrasing may differ. Part of an answer is a miss, so '60' for '60 to 100 bpm' is 1.** 1=Again (wrong, blank, or anything the card asks for left out), 2=Hard (the whole answer, but slowly or unsurely), 3=Good (the whole answer), 4=Easy (the whole answer at once). **State the exact answer on a miss, then immediately ask next_card's front. A null next_card ends the session. Wrap up briefly.**" | "Record the learner's real answer to the card" |

| Flash `create_cards` description | Skola `add_cards` description |
|---|---|
| "Use this when the user wants flashcards: **made from notes, slides or a file they share, a topic they name, or this conversation**, or to memorize something and review it later. ... **To change existing cards use update_cards, not new copies.**" | "Add flashcards to a deck (max 50 per call)" |

**Skola++ spec:** Rewrite all study + card tool descriptions to be conversational guides. Each description should answer: when to use it, what to do with the result, what NOT to do. Specific additions:

- `start_study_session`: add "ask the first card and wait for the user's answer. Follow grading_mode for the whole session. Never read card IDs, session IDs, or scheduling numbers aloud."
- `show_answer`: add "Returns the back; tell it to the user, then immediately call submit_review with rating 1 (Again). Do not guess the user's rating before they answer."
- `submit_review`: add the full Flash grading rubric verbatim.
- `add_cards`: add "Use this when the user wants to memorize something: from notes, a file, a topic, or this conversation. To change existing cards use edit_card, not new copies."
- `end_session`: add "Give the user a one-sentence recap of how they did."
- `list_decks`: add "Start most sessions with this. A deck's counts already include its sub-decks; never add rows up."

**File:** `src/server/mcpStudy.ts`, `src/server/mcpNotes.ts`, `src/server/mcpManage.ts` — update `description` fields in every study + card tool registration.

---

### 9.8 HTML Card Fields

**Flash source:** `args.rs:263–278` (`NewCard.front_html`, `NewCard.back_html`)

Flash stores and returns `front_html` / `back_html` — sanitized HTML. Cards support `<b>`, `<i>`, `<sup>`, `<sub>`, `<br>`, `<ul>`, `<li>`. The schema descriptions explicitly instruct the AI: "Write what plain text loses as HTML (`10<sup>5</sup>`, not 105; `H<sub>2</sub>O`; `<br>` between lines)."

Skola stores plain text strings in note `content.front` / `content.back`. Rich HTML is not supported.

**Skola++ spec (Phase 16.2 addition):** Add optional HTML sanitization for `add_cards` and `edit_card`. Accept `front_html` / `back_html` in addition to `front` / `back`. Sanitize with `sanitize-html` (allow: `b`, `i`, `em`, `strong`, `sup`, `sub`, `br`, `ul`, `ol`, `li`, `p`). Store the sanitized HTML as the field value. Return `front_html` / `back_html` in `list_cards` and study responses.

This is a Dexie schema change (note content shape expands) — requires a new Dexie version.

---

### 9.9 `list_decks` Returns Goal Data Per Deck

**Flash source:** `out.rs:323–354` (`DeckOut.goal: Option<GoalOut>`)

Flash's `list_decks` returns a full `goal` object per deck:
```json
{
  "name": "Pharmacology",
  "due": 12,
  "new": 5,
  "archived": false,
  "goal": {
    "date": "2027-03-15",
    "days_left": 128,
    "passed": false,
    "on_track": true,
    "behind_by": 0,
    "new_per_day": 3,
    "learned": 142,
    "total": 500
  }
}
```

This gives the AI a complete picture of exam pacing without needing a separate `get_deck` call.

Skola's `list_decks` returns `{id, path, cards, paused}` — no exam date or pacing data.

**Skola++ spec:** Add optional `goal?: { date, days_left, on_track, behind_by, new_per_day, learned, total }` to `list_decks` output when a deck has an `exam_date` set.

---

### 9.10 Summary: What Makes Flash AI-First

Flash's MCP server is designed around a central principle: **the AI should never have to think about what to do next.** Every tool response includes exactly the right instruction for the AI's next action. The AI is a conductor following a score, not an improviser.

| Flash AI-first mechanism | Current Skola | Required change |
|---|---|---|
| `grading_mode` per session | ❌ | Add to settings + session response |
| `note` on empty queue (4 states, OFFER_FIRST_CARDS) | ❌ | Add `queue_note()` logic |
| `note` on `create_cards` (panel-conditional terse) | ❌ | Add panel-conditional note |
| `note` on `end_session` (site CTA) | ❌ | Add site URL in response |
| `note` on `list_decks` (OFFER_FIRST_CARDS when empty) | ❌ | Check card count |
| `comes_back_in_ms` on `show_answer` | ❌ | Add FSRS preview function |
| `next_card` prefetch in panel | ❌ | Add to PanelOut |
| `preload` URLs in panel | ❌ | Add signed URL warming |
| `panel_state` drives 4 view states | ❌ | Add state machine to panel |
| `answer_ms` response-time telemetry in `panel_grade` | ❌ | Add `answer_ms?: number` field, store in review log |
| Speech fields REQUIRED in schema | ❌ | JSON Schema transform |
| Tool descriptions as action guides | ❌ | Rewrite all descriptions |
| HTML fields (`front_html`/`back_html`) | ❌ | Add HTML sanitization |
| Goal data in `list_decks` | ❌ | Extend list_decks output |
| Strict grading rubric in `submit_review` | ❌ | Rewrite description |

All of these are **Phase 16.1 and 16.2 work** — none require new DB tables. They are description changes, response shape additions, and logic additions in existing files.

---

## 10. SPEC.md Phase Table Updates

Add these phases to `docs/SPEC.md`:

| Phase | Title | Status |
|---|---|---|
| 16.1 | Deck ergonomics & pacing (MCP backend) + `list_tags` MCP tool | SPEC DONE 2026-11-07 |
| 16.2 | Study & note enhancements (typed input, `blank` cue, language tags, `speech_by`) | SPEC DONE 2026-11-07 |
| 16.3 | MCP UI panel bridge + signed media proxy | SPEC DONE 2026-11-07 |
| 17 | Anki .apkg import/export + CSV import + revlog replay (`progress` option) | OPTIONAL, LATER |
| 18 | Security & auth hardening + `source` + `answer_ms` migration | OPTIONAL, LATER |
| 19 | Multi-user invite | OPTIONAL, LATER |
| 20 | Stats & analytics dashboard — **client-side Dexie** (streak, heatmap, retention %, forecast) | SPEC DONE 2026-11-07 (revised: no server route) |

---

## 10b. ADR References

**ADR 0016 is now taken** (`adr/0016-master-card-lens-over-cards.md`), so the placeholders below shift up by one when they are written. ADR numbers below (0016 to 0035) are **proposed placeholders**, not accepted decisions. The repo's ADRs stop at 0015 (and 0006 and 0007 are each used twice). Number them only when each is written and accepted with `docs/adr/template.md`.

- **ADR 0016:** `Parent::Child` path syntax — prefer `::` separator over `/` to avoid ambiguity with deck names containing slashes. Auto-create missing ancestors silently (no error, only report what was created).
- **ADR 0017:** Card history retention — extend to 90 days / 20 versions to match Flash parity. Storage cost is negligible (text only, no images in history).
- **ADR 0018:** MCP UI panel protocol — adopt `io.modelcontextprotocol/ui` extension `_meta["skola/panel"]` (not `flash/panel`) to avoid vendor namespace conflict.
- **ADR 0019:** `basic_typed` grading — edit distance is returned as metadata but does not influence FSRS scheduling; grading remains AI's responsibility with the strict rubric hint.
- **ADR 0020:** Anki import strategy — use `sql.js` (WASM SQLite) for `.apkg` parsing server-side in a Vercel function; cap at 100 MB; skip unsupported note types with a report.
- **ADR 0021:** WebAuthn adoption — add alongside email+password (not replace); use `@simplewebauthn` library; passkeys stored per-device in new table.
- **ADR 0022:** MCP error code format — adopt machine-readable `code` string in error `data` matching Flash's vocabulary (`no_deck`, `not_found`, `over_cap`, `confirmation_expired`, `confirmation_target_changed`, `confirmation_target_mismatch`, `confirmation_invalid`, `too_many_pending_confirmations`, `internal`); all Skola MCP errors must be `invalid_params` or `internal_error` JSON-RPC, never raw HTTP codes.
- **ADR 0023:** Stats dashboard — build as a new page `/#/stats` using **client-side Dexie queries only** (no server route). Review logs do sync, but computing locally keeps the page offline-capable; server-side computation is not possible without syncing raw review logs, which is explicitly out of scope. All stat logic lives in `src/logic/stats.ts`, testable with fake-indexeddb.
- **ADR 0024:** Paced deck budget isolation — new cards from a deck with an exam date draw from a per-deck slot only, never consuming the account-wide new-card pool; non-paced decks share the global pool.
- **(dropped) review-log immutability trigger:** the server has no `review_log` table; review logs are rows in `changes`, and append-only behaviour is already N1.
- **Open question (not decided):** Deck path storage — evaluate switching from `parent_id` UUID references to path-string storage (`"Bio::Cells"`) matching Flash's approach. Path strings make `rename_deck` with re-parenting a single string replace; UUID approach requires recursively updating all descendant `parent_id` values.
- **ADR 0027:** `dropped_slots` for cloze — when a cloze deletion is removed, add its index to `dropped_slots` on the note rather than renumbering remaining slots. Preserves card ordinal stability for existing review history.
- **ADR 0028:** CSV import — plain text only (no HTML); `front`, `back` required, `tags` semicolon-or-comma, `deck` as `Parent::Child` path. No special handling of cloze syntax in CSV (import as basic).
- **ADR 0029:** Anki export scheduling — reset all scheduling fields to 0 on export (cards appear as "new" in Anki). Do NOT attempt to serialize FSRS state into Anki fields; they are incompatible algorithms.
- **Background jobs:** not implemented. No cron, polling or workers (non-goal N3). R2 cleanup happens when the server applies a delete, checking that no other note still uses the picture; failures leave an orphan.
- **ADR 0031:** Media deduplication — SHA-256 hex format (not base64); same file content = same blob key; create new metadata row but skip blob write on duplicate; enforce two caps (byte total + object count) as soft limits returning user-facing errors, not 413.
- **ADR 0032:** Session security model — 30-day non-sliding sessions; `__Host-` cookie prefix; SHA-256 hash only stored in DB; `change_password` logs out all other sessions; password reset logs out all sessions; `via_link` sessions restricted from sensitive ops.
- **ADR 0033:** Import `colors` field is a string enum (`"keep" | "clean"`), not a boolean. Aligns with Flash's CommitBody schema.
- **ADR 0034:** Deck cap = 500 per user, enforced atomically — multi-segment path creation is all-or-nothing; creation under archived parent is refused.
- **ADR 0035:** CSV injection prevention — cells starting with `=`, `+`, `-`, `@`, `\t` prefixed with `'` on CSV export; importer strips the prefix on re-import.

---

## 11. Full Source Sweep — Additional Gaps (Cavecrew Session 2026-11-07)

> This section records all new gaps and corrections found by reading Flash's remaining Rust source files: `mcp.rs`, `errors.rs`, `card.rs`, `deck_path.rs`, `deck_tree.rs`, `goal.rs`, `speech.rs`, `bounds.rs`, `config.rs`, `export_flow.rs`, `api/today.rs`, `api/stats.rs`, `api/tags.rs`, `api/study.rs`, `api/settings.rs`, `queue.rs` (full), `card_tools.rs` (full), `flash-scan/` (all files). Items are grouped by the phase they belong to.

---

### 11.1 MCP Protocol Details (Phases 16.1 / 16.3)

**Session persistence: not needed.** Skola's `/mcp` is stateless JSON over POST (no session ids, no SSE), so nothing needs to survive a restart. A dropped connection just starts a new session.

**Body limit — 1 MiB:** Flash enforces `MCP_BODY_LIMIT = 1 MiB` on all MCP requests. Skola should enforce a similar limit to prevent large-payload abuse.

**SSE: not applicable.** Skola replies with plain JSON, so there is no `retry:` frame to worry about.

**Machine-readable error codes:** Flash's `errors.rs` converts every `ServiceError` to a JSON-RPC error where the `data` field carries:
```json
{ "code": "confirmation_expired" }
```

Full vocabulary: `no_deck`, `not_found`, `over_cap`, `internal`, `confirmation_target_changed`, `confirmation_expired` (10 min TTL), `confirmation_target_mismatch`, `confirmation_invalid`, `too_many_pending_confirmations`.

**Skola++ spec:** Every `mcpError()` call in Skola should include `{ data: { code: string } }`. The AI reads these codes and can retry or explain intelligently (e.g., "your confirmation token expired — shall I re-fetch the counts?").

**Confirmation token scoped to connector client:** Pending confirm tokens are scoped to `ConnectorClientId` (not just `UserId`). Two different AI clients cannot accidentally confirm each other's destructive operations.

**Host check:** `origin(req)` already pins the address to `APP_URL` when it is set; confirm that is enough before adding a separate allowlist.

**Per-call telemetry:** Flash logs every tool call with `{tool, detail_code, elapsed_ms, client_name, user_id}`. Skola should add equivalent structured logging for support and analytics.

---

### 11.2 Note Types Correction

Flash has exactly **4 note types**, not 2. Correct names (from `notes.rs`):

| Flash type | Cards generated | Skola equivalent |
|---|---|---|
| `Basic` | 1 card (front→back) | `basic` |
| `BasicReversed` | 2 cards: ord 0 (F→B) + ord 1 (B→F), HTML swapped per side | `reverse` (rename to `basic_reversed`) |
| `BasicTyped` | 1 card, `type_answer` = back text, triggers typing input UI | `basic_typed` (Phase 16.2) |
| `Cloze` | N cards, one per `{{cN::answer}}` deletion, ord = deletion_index − 1 | `cloze` |

**Correction:** Skola's existing `reverse` type must generate exactly 2 cards atomically — when the note is updated, both cards' HTML must be swapped together. `mcp_source_state()` tracks these as siblings; updates to the shared source reach all siblings atomically.

**`BasicTyped` study behavior (REST source):** The reveal endpoint (`/study/sessions/{sid}/reveal`) accepts an optional `typed: string` — the user's typed answer — which is compared against `type_answer` on reveal. The MCP `show_answer` tool should accept an optional `typed_answer?: string` field for BasicTyped cards and return `{ exact_match: boolean, edit_distance: number }` alongside the answer.

---

### 11.3 Deck Path Parsing Specification

From `deck_path.rs` — exact rules Skola must implement in `resolveDeckPath`:

- **Separator:** exactly `"::"` (two colons). A single `:` is part of the name (`"Week 1: Intro"` is one segment).
- **Display form:** `" › "` (space-em-arrow-space) — never stored, only for UI display.
- **MAX_LEN:** 200 bytes for full path including separators.
- **Normalization:** split on `::`, trim each segment, drop empty segments. Leading/trailing `::` removed.
- **Descendant check is whole-segment:** `"Bio2::Cells"` is NOT a descendant of `"Bio"`. Must match whole segments to avoid false ancestry.
- **Orphan display:** Deck without its parent deck stored: displays full `"Bio::Cells"` path as the leaf name in the tree.
- **Sibling sort:** case-insensitive (`lowercase` first, then original string for stability).
- **Case sensitivity:** deck names are case-preserved but case-insensitive for path matching.

---

### 11.4 Goal Pacing Algorithm

From `goal.rs` — exact formula for Skola's `deck_schedule` and exam-date pacing:

```typescript
function computeGoal(params: {
  daysLeft: number;    // calendar days from today to exam_date
  unseen: number;      // new cards not yet learned
  desiredRetention: number;  // e.g. 0.9
}): { newPerDay: number; windowDays: number; recallTarget: number; behind_by: number } {
  const windowDays = Math.round(params.daysLeft * 0.12)
    .clamp(3, 14)
    .min(params.daysLeft - 3);
  const learnDays = Math.max(1, params.daysLeft - windowDays);
  const newPerDay = Math.ceil(params.unseen / learnDays);  // ceiling division
  const recallTarget = Math.min(0.99, Math.max(0.95, params.desiredRetention + 0.05));
  const behindBy = Math.max(0, params.unseen - newPerDay * learnDays);
  return { newPerDay, windowDays, recallTarget, behind_by: behindBy };
}
```

**Window interpretation:** The last `windowDays` before the exam are reserved for final review of learned cards. New acquisition stops at `daysLeft - windowDays`. Cards due past the exam date that are below `recallTarget` retrievability get rescheduled into the window using `card_id.rem_euclid(windowDays)` for deterministic distribution.

**Recall target:** Always 95–99% (adds 5% margin over `desired_retention`). This ensures the final exam day has well-consolidated material.

---

### 11.5 Queue & Scheduler Details

From `queue.rs` (full read) — exact priority order Flash uses to pick the next card:

```
1. Learning / Relearning cards whose step timer has expired  — sorted (due_ms, card_id), NEVER capped
2. Due review cards (oldest due first)                       — sorted (due_ms, card_id), budget-capped
3. New cards (creation order)                                — sorted by card_id, budget-capped
4. If all queues empty → learn-ahead: Learning/Relearning cards due within 20 min
```

**No new/review interleaving.** Each phase is exhausted before the next begins.

**Paced deck budget isolation:** New cards from decks with an exam date (`paced: true`) draw from their own per-deck slot. They do NOT consume the account-wide `new_total`. This means a user can study toward an exam without it eating into their daily budget for other decks. Skola's current preset system has no equivalent — this requires a new field on the deck or preset.

**Sibling suppression:** NOT in `queue.rs`. Both siblings (BasicReversed front+back) can appear in the same session if both are due. Suppression happens in the session builder (not yet read — potential additional gap).

**Leech detection:** NOT in `queue.rs`. Leeches are caught during review when `lapses` exceeds the threshold, not during queue construction.

**Study day boundary:** `day.rs` computes the study day cutoff at the user's local `cutoff_hour` (default 4 AM). DST is handled correctly — a cutoff at 4 AM local means days can be 23 or 25 hours during transitions. Cards due "today" means `due_ms < today_cutoff_ms` in local time.

---

### 11.6 Speech Block Corrections

From `speech.rs` — corrections to Section 4.4 and Phase 16.2 spec:

- **Three cues, not two:** `equation`, `look`, `blank` — `blank` signals a gap/pause (e.g., "fill in the blank" oral prompt). The spec previously only listed two.
- **Cantonese → `look`:** All Cantonese BCP47 variants (`yue`, `zh-hk`, `zh-mo`, `zh-hant-hk`, `zh-hant-mo`) automatically redirect to a `look` cue. TTS cannot read Cantonese; Flash signals "show it visually instead."
- **Deduplication:** Consecutive Cantonese blocks collapse to a single `look` cue.
- **Text normalization:** Whitespace collapsed (split + rejoin) then NFC Unicode normalization. Empty blocks after normalization are silently dropped.
- **Language validation:** Unknown language codes rejected with a human-readable error. Underscores become hyphens; lookup is case-insensitive.
- **`MAX_BLOCKS = 64`** per card side.

**Updated SpeechBlock TypeScript type for Phase 16.2:**
```typescript
type SpeechCue = "equation" | "look" | "blank";   // ← blank was missing
type SpeechBlock = { lang: string; text: string } | { say: SpeechCue };
```

---

### 11.7 Bounds & Limits Catalog

From `bounds.rs` — all limits Skola must enforce to match Flash's behavior:

| Bound | Value | Where to enforce |
|---|---|---|
| Cards per MCP call | 500 | `add_cards`, `bulk_update_cards`, `delete_cards` schemas |
| IDs per call | 20 | Multi-ID lookups |
| Card side length | 10,000 bytes (after NFC) | `add_cards`, `edit_card` validation |
| Deck name (full path) | 200 bytes | `create_deck`, `rename_deck`, `resolveDeckPath` |
| Deck description | 2,000 bytes | `update_deck` |
| Tags per card | (from store constant) | `add_cards`, `edit_card` |
| Tags per study scope | 10 | `start_study_session` tags array |
| Decks per filter | 50 | Deck filter inputs |
| Display name | 120 bytes | Profile settings |
| JSON value size | 256 KB | MCP response guard (card with HTML + cloze text) |
| Media objects per user | 20,000 | R2 upload guard |
| Speech blocks per side | 64 | `add_cards` speech validation |
| list_cards page size | 64 KB | `list_cards` response builder — stop adding cards when page exceeds 64 KB |

---

### 11.8 `list_cards` Enhancements (Phase 16.1 addition)

From `card_tools.rs` (full read) — Skola's `list_cards` is missing these features that Flash's has:

**Pagination:** Flash uses a `before_card_id` cursor (not offset-based). Returns `total_count` (unpaginated), `next_cursor` (card_id of last returned card), `has_more: boolean`. Skola should adopt this cursor pattern.

**Byte-bounded pages:** Flash stops adding cards to the response when the page would exceed `LIST_PAGE_BYTES = 64 KB`. Large imported cards (HTML + cloze text) can be kilobytes each; a 50-card page could overflow context. Skola should do the same.

**Source object per card:** Flash's `list_cards` includes a `source` object with each card:
```json
{
  "source": {
    "note_id": "...",
    "note_type": "BasicReversed",
    "front_html": "...",
    "back_html": "...",
    "tags": ["anatomy"],
    "sibling_ids": ["card_b_id"]
  }
}
```
Skola's `list_cards` returns individual card fields but not the linked note + siblings. Add `source` to `list_cards` response.

**Media URLs:** Card list responses include authenticated URLs for any embedded media (Bearer-token-signed). Skola should sign R2 URLs before returning them in list_cards.

---

### 11.9 Stats & Analytics Dashboard (Phase 20)

From `api/stats.rs` — Flash has a full study analytics REST endpoint. Flash can compute these server-side because its review log is in SQLite on the server.

**Skola choice:** review logs sync, so the server could compute these, but stats are computed **client-side from Dexie** so the page works offline and needs no server route.

**Data to show (same shape as Flash, computed locally):**

```typescript
interface StudyStats {
  retention_pct: number | null;    // from reviewLogs: rating>=3 / total (phase_before Review/Relearn)
  streak: number;                  // consecutive study days ending today (Dexie reviewLogs)
  longest_streak: number;          // lifetime max streak (computed on demand)
  daily_avg: number;               // avg reviews per active day
  total_reviews: number;           // reviewLogs.count()
  active_cards: number;            // cards not suspended
  mature_cards: number;            // cards with scheduledDays > 21
  heat_weeks: HeatCell[][];        // GitHub-style heatmap from reviewLogs
  upcoming: DayCount[];            // next 7 days forecast from card due dates (Dexie cards)
}
```

**Skola++ Phase 20 spec — client-side only:**
- New UI page `/#/stats` — React component that runs live Dexie queries on mount.
- All computations in `src/logic/stats.ts` (pure functions over Dexie result arrays, testable with fake-indexeddb).
- Streak: group reviewLogs by local study day (using `nextDayStartTime` from settings, default 4 AM); count consecutive days ending at today.
- Heatmap: bucket reviewLogs by local calendar day; intensity 0–4 based on review count percentile.
- Forecast: query `cards` where `due < now + 7 days` and `state != 0` (not new); group by day.
- Retention: `reviewLogs.filter(r => r.phase_before >= 2).count` → `rating >= 3` ratio.
- No server route, no Postgres table, no cron. Offline-capable by design.

**Open:** If the user wants stats visible across devices before they open the app (e.g., a server-rendered dashboard), a lightweight "stats sync" (pushing daily aggregates, not raw logs) could be added as a future ADR. Not needed for Phase 20.

---

### 11.10 REST API Features with No MCP Equivalent

From `api/today.rs`, `api/tags.rs`, `api/settings.rs` — features Flash exposes via REST that have no MCP equivalent and that Skola needs to build independently:

| Feature | Flash endpoint | Skola equivalent needed |
|---|---|---|
| Today dashboard | `GET /today` — boost_today, reviewed_today, show_connect_cta | `/#/home` already has due counts; add reviewed_today |
| App badge count | `GET /badge` — returns int for icon badge | Service worker or native badge API |
| Study boost (REST) | `POST /study/boost` | Skola has `boost_new_today` MCP; also needs REST endpoint for the app UI |
| Connect setup | `GET /connect` — returns mcp_url, claude_code_cmd | Settings page already shows this |
| Tag list | `GET /tags?deck=` — tags with per-tag card counts | No Skola equivalent; add `list_tags` MCP tool |
| Grading mode setting | `PUT /settings/grading` | Skola settings page needs this after Phase 16.1 adds grading_mode |
| Study preferences | `PUT /settings/study` — timezone, day_cutoff_hour, desired_retention, due_by_day | Skola settings page; some already in preset |
| CSV export | `GET /export/csv` | Phase 17 addition |
| Account deletion | `DELETE /account` — requires "DELETE" string + password | Settings > Danger zone |
| Passkey management UI | Passkey list, add, delete | Phase 18 UI |

**`list_tags` MCP tool (Phase 16.1 addition):**
```typescript
// Tool: list_tags
// Input: { deck?: string }  — optional deck scope
// Output: { tags: Array<{ name: string; card_count: number }> }
// Purpose: AI can offer tag-based study sessions without guessing tag names
```

---

### 11.11 Phase 17 Addition — CSV Export

Flash exports cards as CSV in addition to .apkg. Skola's Phase 17 should include both:

**CSV format:** one row per card, columns: `front_html`, `back_html`, `tags` (space-separated), `deck` (full path), `type`, `due_date`, `stability`, `difficulty`.

Filename: `skola-YYYY-MM-DD.csv` or `<deck>-YYYY-MM-DD.csv`.

Route: `app/api/export/csv/route.ts` — streams Drizzle query results through a CSV serializer; no size limit (server-streamed).

---

### 11.12 Export & Import — Revlog and Round-trip Details

From `flash-store/src/export/apkg.rs` and `import/apkg.rs` — the open question is now closed:

**Export (`export/apkg.rs`):**
- Revlog: **NOT exported.** The schema creates the `revlog` table but writes zero rows.
- All scheduling fields (`ivl`, `factor`, `reps`, `lapses`) are hardcoded to 0 on export. Cards in the exported `.apkg` are all treated as "new" by Anki.
- HTML is preserved and media refs are rewritten: Flash's `/media/{id}` → Anki filename; `[sound:audio.mp3]` → `[sound:audio.mp3]` (kept as-is for audio).
- Three Anki model templates: Basic, Cloze, BasicTyped (using `{{type:Back}}` for typing input).
- Cloze round-trip: `cloze_text` is stored on the note to allow faithful re-export of the source with deletion markers.

**Import (`import/apkg.rs`):**
- Suspension preserved: `card.queue == -1` → `suspended: true`.
- Scheduling fields NOT read: `ivl`, `factor`, `reps`, `lapses` are ignored. All cards start fresh in Flash.
- Revlog IS read but only for history replay: `type IN (0,1,2)` (Learn/Review/Relearn), `ease BETWEEN 1 AND 4`. Types 3–4 (Cram/Manual/Rescheduled) skipped.
- Language tags detected and stored per field (`front_lang`, `back_lang`).
- Text/HTML pipeline: scripts and styles are stripped outright; Anki color classes are remapped to hex; images are referenced by placeholder until committed.
- Cards with empty front or back after sanitization are skipped (counted as `skipped`).
- Layouts with `ord >= 2` are counted as `extra_layouts_skipped` (Flash only supports 2-card notes).

**Skola Phase 17 update — confirmed behavior:**
- Export: generate `.apkg` with scheduling reset to 0 (same as Flash). Skola review history is NOT embedded in the export — this is intentional (Anki would override FSRS state anyway).
- Import with `progress: true`: replay eligible revlog rows into Skola's `review_log` as source `'import'`. Cards graduate from New to their FSRS state after FSRS re-parameterization from imported history.
- The `cloze_text` field must be stored on cloze notes (needed for round-trip export fidelity).

---

### 11.13 CSV Import (Phase 17 Addition — Previously Undocumented)

From `flash-store/src/import/csv_file.rs` — **Flash supports CSV import.** This was completely absent from the spec.

**CSV format:**
```
front,back,tags,deck
"What is mitosis?","Cell division producing two identical cells","biology;cells","Bio::Cells"
```

- `front` and `back` are **required** (case-insensitive header match).
- `tags` is optional: semicolon- or comma-separated strings, trimmed and deduplicated.
- `deck` is optional: full `Parent::Child` path string; absent means default deck.
- Plain text only — no HTML in CSV import fields.
- Suspended flag: always false (all CSV-imported cards start active).

**Skola Phase 17 addition:**
- New route `app/api/import/csv/route.ts` — parse CSV with `papaparse`, map to `add_cards` calls.
- New UI: Import page adds CSV tab alongside .apkg tab.
- Accept up to 10,000 rows per upload (Flash has no documented limit; set a reasonable Vercel limit).

---

### 11.14 SQLite Schema Findings (Affects Skola Data Model)

From `flash-store/src/migrations.rs` — behavioral assumptions embedded in the schema that Skola must match:

**Review log is immutable.** Flash uses DB triggers to prevent UPDATE and DELETE on `review_log`. Only cascade-deletes on user deletion are allowed. Skola's review log in Postgres should have equivalent constraints — no soft-delete, no edit, append-only. This is the audit trail for FSRS.

**Review source tracking:** `review_log.source IN ('mcp', 'web', 'import', 'mobile')` and `review_log.client TEXT` (OAuth client name). Skola should add `source` to its review log to distinguish MCP-graded vs app-graded reviews.

**`answer_ms INTEGER`** (V035) on `review_log` — confirms the response-time telemetry field. Skola needs a migration to add this column.

**Deck tree stored as path strings** — there is no `parent_id` on decks. The hierarchy is built at query time by parsing the `name` path string. This is different from Skola's current approach of `parent_id` UUID references. The path-string approach makes `rename_deck` with re-parenting trivially a string replace; the UUID approach requires updating all descendant parent_id fields.

**`dropped_slots TEXT DEFAULT '[]'`** (V048) on notes — when a cloze deletion is removed from a note, its slot index is added to `dropped_slots` rather than renumbering remaining slots. This prevents card ordinal shifts that would break existing review history. Skola's cloze implementation must do the same.

**`speech_by TEXT IN ('assistant', 'labeler')`** on notes — tracks who generated the speech blocks: `'assistant'` means an AI tool call generated them; `'labeler'` means a human or specialized labeling tool. Skola should add this field for future auditability.

**`front_lang` / `back_lang TEXT`** (V040) on notes — BCP 47 language tags detected on import or declared by the AI. Used for TTS selection. Skola should add these columns once speech blocks are implemented.

**ID floor enforcement:** Flash never reuses a deleted integer ID. After deletion, the floor is raised to `max(id) + 1` for future inserts. This prevents ghost-ID collisions in distributed sync scenarios. Skola uses UUIDs, so this is not a concern.

**`note_type` constraint:** `CHECK note_type IN ('basic', 'basic_reversed', 'basic_typed', 'cloze')` — exact enum values stored. Skola should enforce the same constraint on its `noteType` field.

**max 32 pending confirmations per user** — `mcp_confirmations` enforces this limit. Skola's confirmation table should do the same.

**Triggers auto-invalidate confirmations** when referenced cards or decks are deleted mid-flow. Skola needs equivalent logic (a Postgres trigger or application-level check on confirmation resolution).

---

### 11.15 Background Job Architecture (jobs.rs) — NOT APPLICABLE TO SKOLA

Flash uses a 5-second Postgres poll with leases and retry backoff (`[60s, 5m, 30m, 2h, 12h]`). Its core handlers are `JOB_DELETE_BLOBS` (R2 orphan cleanup) and `JOB_OAUTH_CODE_CHECK` (expire stale OAuth codes).

**Skola decision: do not implement a background job system.**

Skola's rule (non-goal N3, few API calls, and no cron, polling or background worker of any kind) makes a job system incompatible. Work happens inside the request that needs it.

**Instead, use event-driven cleanup:**

| Flash job | Skola equivalent |
|---|---|
| `JOB_DELETE_BLOBS` | Notes are deleted on the device and reach the server as sync tombstones, so the cleanup runs when the server applies a delete. Pictures are keyed by SHA-256 per user and one picture can serve several notes, so delete the R2 object only when no remaining note references that `media:<sha256>`. If the R2 delete fails, accept an orphan (storage is capped per account); no table, no drain script. |
| `JOB_OAUTH_CODE_CHECK` | OAuth codes already have `expires_at` column. Stale codes are simply rejected on use — no active cleanup needed. Prune with `DELETE WHERE expires_at < now() - interval '7 days'` on the next auth request (lazy cleanup). |
| Future: FSRS optimizer | Already client-side WASM — no server job needed. |

**Phase 21 (background job system) is removed from the roadmap.** Reminder emails are also out: a daily digest would need a cron. If reminders are wanted, show them in the app and over MCP only.

---

### 11.16 Review Statistics Query Details (repo/reviews.rs)

From `repo/reviews.rs` — exact implementation details for the Phase 20 stats dashboard:

**Heatmap computation:** Reviews are bucketed into **15-minute UTC intervals**: `Math.floor(reviewed_at / 900_000) * 900_000`. The raw query returns all-time buckets. **The app layer must convert UTC bucket timestamps to the user's local calendar day** before grouping into the GitHub-style heatmap. Skola must do the same — a PostgreSQL query returning `(user_id, bucket_ms, count)` and a TypeScript function that localizes them.

**Retention % formula:** Not a dedicated SQL query — derived from review_log. Only `phase_before IN (2, 3)` rows count (Review or Relearning phase; excludes Learning steps). Formula: `(count where rating >= 3) / count(*) * 100` over a rolling window.

**Forecast:** `due_between(from_ms, to_ms)` returns raw `due_ms` timestamps for active, unsuspended, non-new cards. The app groups these into daily buckets. Skola needs a Postgres query: `SELECT due_ms FROM card_state WHERE user_id=$1 AND phase != 0 AND due_ms BETWEEN $2 AND $3`.

**Study streak:** NOT computed in `reviews.rs` — located elsewhere in Flash. Skola must compute independently: query `review_log` for distinct study days (using user's `day_cutoff_hour` and `timezone`), then count consecutive days ending at today.

**Pagination warning:** `reviews_since()` and `queue_entries()` return **full unbounded result sets**. For accounts with 10k+ reviews, Skola must paginate or stream these queries.

**Required indexes for stats performance:**
```sql
-- review_log time-range scans
CREATE INDEX idx_review_log_user_time ON review_log (user_id, reviewed_at);
-- study queue construction
CREATE INDEX idx_cards_study ON cards (user_id, suspended, deck_id)
  WHERE deleted_at IS NULL;
```

---

### 11.17 REST API Endpoints Still Missing from MCP

From `api/cards.rs` and `api/decks.rs` — features the web/mobile app uses that have no MCP equivalent and that Skola must build independently:

**Rich HTML card editor (REST-only):**
- `GET /cards/{id}/editor` — returns `EditorSeed` with `front_html`, `back_html` for editing
- `PUT /cards/{id}/editor` — saves `NoteBody { note_type, front_html, back_html, tags, langs }` and returns sanitized HTML
- `GET /editor/meta` — returns `{ note_types[], hues[] }` (color vocabulary for the sanitizer)

These are used by the in-app card editor. The MCP `edit_card` works on plain text only. Skola's card editor already works on plain text — adding HTML editing requires building these same REST endpoints plus a rich-text editor component (Phase 16.2 or later).

**Deck REST endpoints not in MCP:**
- `POST /decks/{id}/move` — moves a deck (with all subdecks) to a new parent_id; `null` = top level. This is deck re-parenting. MCP `rename_deck` with `Parent::Child` path covers this but via a different mechanism.
- `PUT /decks/{id}/limits` — sets `new_per_day`, `reviews_per_day` per deck (null = inherit account default)
- `PUT /decks/{id}/goal` — sets `goal_date: "YYYY-MM-DD" | null`
- `POST /decks/{id}/boost` — immediately adds extra new cards for today
- `POST /decks/{id}/archive` / `unarchive` — idempotent REST equivalents of the MCP tools
- `GET /decks/{id}/cards?q=&page=&per_page=` — paginated card search within a deck (page/per_page, default 25, max 100)

Skola already has some of these; the gaps are `move`, the separate `limits` and `goal` endpoints, and full-text card search within a deck.

**`NoteBody.langs` field:** REST card creation accepts a `langs` object specifying BCP-47 language tags per field (front/back). This feeds `front_lang`/`back_lang` on the note for TTS. Skola's `add_cards` MCP tool should accept optional `front_lang`/`back_lang` fields alongside the speech blocks.

**Admin endpoints:**
- `GET /admin/users` — lists all users with deck/card/review counts, last login, MCP clients
- `POST /admin/invites` — creates one-time invite URL with display_name and expiry

---

### 11.18 Media Upload Specification (api/media.rs)

From `api/media.rs` — exact behavior Skola must replicate:

**Three media endpoints:**
1. `POST /media` — upload (multipart field named exactly `"file"`)
2. `GET /media/{id}` — serve with **HTTP 206 Partial Content** support for audio/video seeking
3. `GET /media/{id}/url` — redirect to blob storage URL

**Validation pipeline (in order):**
1. Filename sanitization and length check
2. MIME type classification from extension
3. Reject SVG and unsupported types
4. Byte size check ≤ `MAX_FILE_BYTES`
5. **Magic byte validation** — first bytes must match claimed MIME type; HTML disguised as JPEG rejected here
6. SHA-256 (hex format) computed for deduplication

**Deduplication:** `blob_known(sha256_hex)` check before writing. Same file uploaded twice returns same `media_id` without re-writing the blob. A new metadata row is still created linking to the existing blob.

**Two caps enforced per user (non-admin):**
1. Total bytes in use ≤ `MEDIA_SOFT_CAP_BYTES`
2. Object count ≤ 20,000

Both caps are soft (log + user error, not hard HTTP 413). Admins bypass both.

**Upload semaphore:** `try_acquire_owned()` — immediately returns 429 if another upload is in progress for this user. No queue — the client retries.

**SHA-256 format:** hex string (not base64). TypeScript: `crypto.createHash('sha256').update(bytes).digest('hex')`.

---

### 11.19 Authentication Implementation Details (Phase 18)

From `flows/login.rs`, `flows/reset.rs`, `flows/enroll.rs`, `flows/account.rs`, WebAuthn ceremonies:

**Session tokens:**
- 256-bit random bytes → base64url (no padding)
- Only SHA-256 hex hash stored in DB — token never recoverable from DB
- Session TTL: **30 days**, never extended on activity
- Cookie: `__Host-flash` — `HttpOnly; Secure; SameSite=Lax; Path=/`
- `SameSite=Lax` allows OAuth top-level redirects but blocks form-based CSRF

**Password lockout:** Sliding window — `failed_count >= THRESHOLD` AND `failed_at_ms > now - WINDOW_MS`. Both conditions required. Wrong password gives identical response to locked account (prevents enumeration). Opportunistic re-hashing on successful login if algorithm/cost changed.

**Password reset constants:**
- Token TTL: **1 hour** (3,600,000 ms)
- Cooldown between requests: **1 minute**
- Daily cap: **5 requests per 24-hour window**
- Uniform 200 OK response regardless of outcome (rate limit, unknown email, success)
- Token is single-use; burned atomically on `confirm`
- Reset confirmation revokes **all sessions** (no keeper — premise is compromised password)

**Password change:** Revokes all sessions and API tokens **except** the current device. User stays logged in but all other devices are signed out.

**WebAuthn ceremonies:**
- Challenge TTL: **5 minutes**
- Cookie: `__Host-flash-ceremony` — cleared after ceremony completes
- `ResidentKeyRequirement::Preferred` — discoverable credential (autofill UI support)
- Finish ceremony: re-checks email uniqueness and invite validity inside transaction (race safety)
- Counter update: check for authenticator cloning; update credential on counter change

**`via_link` sessions:** Sessions created from emailed links (e.g., password reset preview link) are flagged `via_link`. Sensitive operations (password change, passkey management, account delete) require re-authentication if `via_link = true`.

**Account deletion safety:**
- Refused if last admin
- Extension can veto via `before_delete()` hook
- Returns `orphan_blobs` list — caller must delete them from blob storage after DB deletion commits
- Never reuses deleted user IDs

---

### 11.20 Import API Details (api/import.rs)

**Two concurrent upload limits:**
1. `upload_semaphore` — limits in-flight multipart body parsing
2. `import_semaphore` — limits concurrent import processing

Both use `try_acquire_owned()` → immediate 429 (`"import-busy"`) if unavailable. No queue.

**Payload limit:** `import_flow::MAX_BYTES + 64 KiB` (multipart framing overhead). Same formula for media upload.

**CommitBody schema (correction to earlier spec):**
```typescript
interface AnkiCommitBody {
  token: string;
  deck?: string;           // must pass bounds::DECK_NAME (200 bytes)
  keep_decks: boolean;
  progress: boolean;       // replay revlog
  settings: boolean;       // adopt FSRS settings
  colors: "keep" | "clean"; // ← string enum, NOT boolean as previously specced
}
```

**Import analytics:** On commit, fires `AccountEvent::new("import_commit")` with `.amount()` = imported card count. Skola should fire equivalent event for import analytics.

---

### 11.21 Data Model Invariants (Integration Tests)

From `store_tests.rs`, `mcp_tests.rs`, `revision_tests.rs`, `export_tests.rs`, `import_vectors_tests.rs` — behavioral guarantees Skola must match:

**Caps and limits:**
- `MAX_DECKS_PER_USER = 500` — enforced atomically; path creation is all-or-nothing (if 3-deck path would exceed cap, none are created)
- Card creation cap is per-deck, enforced atomically — no partial batch inserts
- Cannot create a deck under an **archived parent** — rejected with error
- `%` and `_` in deck names are **literal characters**, not SQL wildcards (LIKE escaping required)

**Archive semantics (confirmed):**
- Archive is **visibility-only** — cards still owned, review history intact, card_totals unchanged
- `set_deck_archived()` archives entire subtree **deepest-first**; already-archived subdecks are not re-archived
- `unarchive` also lifts **ancestors** (parent decks that were archived as part of the subtree)
- Due/new counts show **zero** for archived decks in list_decks
- Cannot have a child deck active while its parent is archived

**MCP confirmation invariants:**
- Target is pinned at stage time — subdeck created after approval doesn't invalidate it; subdeck moved into the approved tree **does** invalidate
- `confirmation_target_mismatch` does NOT consume the token — user can retry with updated counts
- Completed receipt is **idempotent** — same (user, client, target, hash) replays the same card list forever
- Subdeck created between preview and confirm: if the new subdeck is under the confirmed deck, approval is invalidated

**Review log:**
- Import deduplicates by `(card_id, timestamp)` — same timestamp on same card is silently ignored (0 rows, not error)
- Import reviews: `source = 'import'`, no `session_id`, no `client`
- Cram reviews (Anki type 3) and manual reschedule (type 4) **discarded** on import

**Revisions:**
- Hard cutoff: **20 revisions max**, **90 days max** — no selective pruning, hard cutoff
- Identical save (same HTML + tags + type after normalization) creates **no revision**
- First edit of a bare card (adopted into a note) creates a revision of the **card's original text**, not the new text
- Restore is itself a revision (`source = 'restore'`); scheduling and review history unchanged
- Restore to fewer cards (e.g., BasicReversed → Basic) is **refused** (would drop a card)

**API token rotation:**
- `REFRESH_GRACE_MS` (≈5 min) — lost response retry within grace returns same token pair without minting new ones
- After grace → "reused token" detection → revoke entire grant
- Spent tokens tracked until their original expiry, then purged

**Language/timezone learning:**
- Newest `learn` signal wins until user explicitly `choose`s
- Once chosen, signal never overwrites choice
- Last-sighting moved max once per day per locale

**Import vector edge cases (from vector tests):**
- Sounds `[sound:file.mp3]` — **stripped** (no audio support in Flash import)
- LaTeX `[$]...[/$]` — **stripped**
- CSS — **stripped**
- `<script>` bodies — **stripped** (not just the tags)
- Suspended cards (`queue=0 or -1`) — `suspended=true` on import (queue=-1) OR active (queue=0)
- Modern .apkg (Anki 23+) uses **Zstd compression** — parser must handle both compressed and uncompressed `collection.anki2`
- Cram reviews (type 3) — **discarded** silently
- Orphaned templates (template without matching card) — skipped, counted as `extra_layouts_skipped`

**Export invariants:**
- **CSV cells starting with `=`, `+`, `-`, `@`, `\t` are prefixed with `'`** (spreadsheet injection prevention). Importer strips the `'` prefix back.
- Round-trip lossless: front, back, tags, deck paths — **scheduling is not round-trip** (intentionally reset to 0)
- Subdeck paths in export auto-create intermediate parent decks in the .anki2 SQLite, even if those parents are empty

---

### 11.22 Anki Template Rendering (import/template.rs)

From `import/template.rs` — exact template syntax handled during .apkg import:

| Syntax | Behavior |
|---|---|
| `{{Field}}` | Substitutes field value |
| `{{#F}}...{{/F}}` | Conditional: show if field non-empty |
| `{{^F}}...{{/F}}` | Negated conditional: show if field empty |
| `{{type:Field}}` | Hidden on front; shown on back (triggers typing input) |
| `{{hint:Field}}` | Rendered as `<details>` collapsible |
| `{{tts:Field}}` | Field text (shown once to avoid duplication) |
| `{{FrontSide}}` | **Renders empty** (Flash stacks front+back; FrontSide would duplicate) |
| `{{Tags}}`, `{{Deck}}`, `{{Card}}`, etc. | All render **empty** |
| Unknown `{{filter:Field}}` | Field value returned; filters stripped |

Cloze deletions (`{{c1::answer}}`) are processed **before** template render — at field population time, not template processing time.

HTML escaping: only `&<>` entities (applied in hint filter output). Regular field substitution does NOT HTML-escape.

---

### 11.23 Remaining Unread Files

All high-priority Flash source files have now been read. The following lower-priority files remain:

| File | Why it might matter |
|---|---|
| `src/api/dto.rs` | DTO shape details — might reveal fields returned to clients not documented elsewhere |
| `src/repo/auth.rs`, `repo/oauth.rs` | OAuth grant lifecycle, token rotation, PKCE S256 details at the store layer |
| `src/repo/notes.rs`, `repo/card_bulk.rs` | Bulk note/card operations — might reveal batching limits or atomicity guarantees |
| `src/repo/jobs.rs` | Job table schema and claim/release queries |
| `flash-store/src/richtext.rs` | HTML sanitization allowlist — exact tags and attributes Skola must permit |
| `flash-store/src/import/colorize.rs` | Anki CSS color → hex remapping — needed for `clean_colors` import option |
| `flash-store/tests/hostile_input_tests.rs` | Adversarial input handling — reveals edge cases for injection, oversized payloads |
| `flash-store/tests/speech_tests.rs` | Speech block validation edge cases |
| `src/account_locale.rs` | Language detection / locale learning details |
| `crates/flash-scan/` | Internal code auditing tool — not user-facing; skip unless building structural tests |

These files are **not blockers** for any Phase 16–20 implementation. Reading `richtext.rs` is recommended before implementing HTML sanitization in Phase 16.2.
