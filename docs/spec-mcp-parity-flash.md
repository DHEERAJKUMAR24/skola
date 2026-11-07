# Skola MCP Parity & Enhancement Specification (vs Flash MCP)

- **Status:** SUPERSEDED by `docs/spec-comparison-flash-deep.md` (2026-11-07), and in turn by `docs/spec-phase-16.md`, the authoritative Phase 16 spec. Kept for the first-pass tool comparison. Reference repo: `D:/Workspace/z-personalWorkspace/flash-ref`.
- **Author:** Antigravity / Engineering
- **Date:** 2026-11-06
- **Tracking:** Phase 16 in `app/docs/SPEC.md`, live status in `app/docs/HANDOFF.md`

---

## 1. Executive Summary & Objective

Flash (`flashmemorize.com`) provides an MCP server connected to remote AI assistants (Claude, ChatGPT, Grok, Mistral, Gemini). While Skola has deeper structural capabilities (FSRS-6 diagnostics, Master Cards, Image Occlusion, K/S Learning Objectives, and Postgres-backed Agent Skills), Flash provides superior conversational ergonomics, speech/voice compatibility, ephemeral study adjustments, and interactive UI panels.

This specification details all architectural, schema, and tool additions required to bring Skola's MCP implementation to complete parity with Flash, while preserving Skola's local-first and free-tier operational constraints.

---

## 2. Comparative Matrix (Flash vs. Skola)

| Category | Flash Tool (26 Total) | Skola Equivalent Tool | Status | Action Needed in Skola |
| :--- | :--- | :--- | :--- | :--- |
| **Pacing & Limits** | `boost_new_today` | *None* | ❌ Missing | Build `boost_new_today` in `mcpLimits.ts` (ephemeral daily +N cards). |
| | `get_limits` | `list_presets`, `get_deck` | ⚠️ Partial | Build `get_limits` in `mcpLimits.ts` (unified view of today's remaining allowances). |
| | `set_limits` | `update_preset`, `update_deck` | ⚠️ Partial | Build `set_limits` in `mcpLimits.ts` (set daily caps & `goal_date` pacing by deck name). |
| **Deck Operations** | `archive_deck` | `update_deck(paused=true)` | ⚠️ Partial | Add `archive_deck` in `mcpManage.ts` (recursively pauses tree, removes from due counts). |
| | `unarchive_deck` | `update_deck(paused=false)` | ⚠️ Partial | Add `unarchive_deck` in `mcpManage.ts` (restores tree to active study). |
| | `rename_deck` | `update_deck` | ⚠️ Partial | Add `rename_deck` in `mcpManage.ts` (supports `Parent::Child` re-parenting). |
| | `create_deck` | `create_deck` | ⚠️ Quality Gap | Support `Parent::Child` string paths with automatic ancestor deck creation. |
| | `delete_deck` | `delete_deck` | ✅ Parity | Both enforce batch confirmation tokens with affected counts. |
| | `list_decks` | `list_decks` | ✅ Parity | Add `archived: boolean` flag to Skola output. |
| **Card Authoring** | `create_cards` | `add_cards` | ⚠️ Quality Gap | Support `Parent::Child` deck names, HTML formatting, and speech synthesis blocks. |
| | `update_cards` | `edit_card`, `bulk_update_cards` | ✅ Parity | Both support fields, tags, and sibling integrity. |
| | `delete_cards` | `delete_cards` | ✅ Parity | Both use two-phase confirmation tokens. |
| | `list_cards` | `list_cards`, `search_cards` | ✅ Parity | Both support pagination, search, and sibling IDs. |
| | `restore_cards` | `card_history`, `restore_card_version` | ✅ Parity | Both list versions and roll back atomically. |
| | *None* | `basic_typed` | ❌ Missing | Add `basic_typed` note type for strict verbatim testing (spelling, code, formulas). |
| **Study Sessions** | `start_study_session` | `start_study_session` | ⚠️ Partial | Add `tags: string[]` multi-tag filtering to `start_study_session`. |
| | `show_answer` | `show_answer` | ✅ Parity | Both reveal answer safely before review. |
| | `submit_review` | `submit_review`, `grade_card` | ✅ Parity | Both record 1-4 ratings into FSRS with idempotent retries. |
| | `end_session` | `end_session` | ✅ Parity | Both provide full session recaps. |
| | *None* | `next_card` | 🌟 Skola Plus | Skola allows skipping cards or re-fetching without grading. |
| **Interactive UI** | `panel_cards` | *None* | ❌ Missing | Add MCP UI endpoint for embedded iframe/card carousel. |
| | `panel_grade` | *None* | ❌ Missing | Add UI button bridge for 1-4 grade clicks. |
| | `panel_show_answer` | *None* | ❌ Missing | Add UI button bridge for answer reveal. |
| | `panel_edit_source` | *None* | ❌ Missing | Allow quick card correction inside chat panel. |
| | `panel_save_edit` | *None* | ❌ Missing | Save quick edits from chat panel. |
| | `panel_archive` | *None* | ❌ Missing | Quick archive card from chat panel. |
| | `panel_reminders` | *None* | ❌ Missing | Study reminder setup from chat panel. |
| **Advanced Tools** | *None* | `find_leeches` | 🌟 Skola Plus | Identify chronic lapses automatically. |
| | *None* | `find_duplicates`, `find_similar_cards` | 🌟 Skola Plus | Levenshtein and vector-like similarity detection. |
| | *None* | `create_master_card`, `master_coverage` | 🌟 Skola Plus | Concept hierarchy & coverage repair. |
| | *None* | `create_objective`, `record_assessment` | 🌟 Skola Plus | Competency Knowledge & Skill mastery tracking. |
| | *None* | `preview_image_occlusion` | 🌟 Skola Plus | Complete visual image occlusion suite. |
| | *None* | `get_skill`, `skill_history` | 🌟 Skola Plus | Full dynamic agent skills registry. |

---

## 3. Skills & Agentic Experience Comparison

| Dimension | Flash Approach | Skola Approach | Analysis & Opportunities |
| :--- | :--- | :--- | :--- |
| **System Prompt Delivery** | Single static instruction block delivered via `instructions` in the `initialize` handshake ([instructions.md](file:///C:/Users/Dheeraj/.gemini/antigravity-cli/mcp/flash/instructions.md)). | Dynamic `serverInstructions` combining base capabilities, `#hierarchy` level descriptions, and user custom instructions ([#aiInstructions](file:///D:/Workspace/z-personalWorkspace/skola/app/src/server/mcpInstructions.ts)). | **Skola is more configurable:** Skola allows users and admins to customize instructions directly from the UI or via MCP tools. |
| **Specialized Agent Skills** | None. Single generic assistant persona. Relies on external prompt crafting. | **5 Dynamic Skills** stored in Postgres (`skill_files`, `skill_history`):<br>1. `skola` (Core Router)<br>2. `skola-active-learning-tutor`<br>3. `skola-card-architect`<br>4. `skola-deck-maintainer`<br>5. `skola-quality-auditor` | **Major Skola Advantage:** Skola provides specialized personas for card generation, auditing, maintenance, and tutoring, plus `/skills/llm.txt` for autonomous discovery. |
| **Grading Philosophy & Guidance** | Explicit, uncompromising grading instructions in `submit_review.json`: *"Grade STRICTLY against the card's back: facts, numbers, doses, and units must match precisely. An imprecise answer is 1 (Again), never 'close enough'."* | Dynamic `next_step` prompts returned with each card turn; suggested ratings for Master Cards; policy in system skills. | **Skola Opportunity:** Skola should adopt Flash's explicit grading rubrics inside `submit_review`'s tool description and `grading_mode` return field to eliminate LLM leniency ("hallucinated correctness"). |
| **Voice & Multimodal Assistants** | Built for speech out of the box: `front_speech` and `back_speech` with language tags and audio cues (`say: "equation"`, `say: "look"`). | Plain text and Markdown/HTML strings. Assistants reading aloud can stumble on LaTeX, formulas, and markup. | **Skola Opportunity:** Adopting Flash's `SpeechBlockArg` syntax will make Skola immediately usable in voice modes (e.g., ChatGPT Voice, Claude Voice). |

---

## 4. Detailed Specifications

### 4.1 Pacing & Limit Tools (`app/src/server/mcpLimits.ts`)

#### Tool: `boost_new_today`
- **Purpose:** Temporarily grants extra new cards for the current calendar day only.
- **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "deck": { "type": ["string", "null"], "description": "Deck name or ID. Omit for account-wide." },
      "extra": { "type": "integer", "minimum": 1, "maximum": 500, "description": "Extra new cards today." }
    },
    "required": ["extra"]
  }
  ```
- **State Storage:** Stored in synced user settings under `#dailyBoosts`:
  ```typescript
  interface DailyBoostRecord {
    date: string; // YYYY-MM-DD
    accountExtra: number;
    deckExtras: Record<string, number>;
  }
  ```
- **Daily Reset:** Evaluated against the user's `nextDayStartTime` (default 4 AM). A new logical day clears the boost.

#### Tool: `get_limits`
- **Purpose:** Consolidated report of study limits and remaining capacity across all decks.
- **Returns:**
  ```json
  {
    "account_defaults": { "new_per_day": 20, "reviews_per_day": 200, "extra_today": 10 },
    "decks": [
      {
        "id": "...",
        "path": "Medicine / Cardiology",
        "new_per_day": null,
        "reviews_per_day": null,
        "goal_date": "2026-12-15",
        "remaining_new_today": 15,
        "remaining_reviews_today": 42
      }
    ]
  }
  ```

#### Tool: `set_limits`
- **Purpose:** Sets daily limits or exam target dates by deck name or account-wide.
- **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "deck": { "type": ["string", "null"] },
      "new_per_day": { "type": ["integer", "null"] },
      "reviews_per_day": { "type": ["integer", "null"] },
      "goal_date": { "type": ["string", "null"] }
    }
  }
  ```
- **Behavior:** Passing `-1` clears deck-specific overrides, falling back to account defaults. Setting `goal_date` updates the deck's exam configuration.

---

### 4.2 Hierarchical Deck Management & Archival (`app/src/server/mcpManage.ts`)

#### Path Resolution Helper (`resolveDeckPath`)
- Accepts either a UUID or a delimited path (`"Medicine::Cardiology"` or `"Medicine / Cardiology"`).
- Automatically splits segments, traverses existing `superDecks`, and returns the target deck.
- If `createMissing: true` is passed, missing parent decks are created in a single batch.

#### Tool: `archive_deck` & `unarchive_deck`
- **`archive_deck`:**
  - Marks target deck and all descendant sub-decks with `archivedAt: timestamp`.
  - Sets `priority: "paused"`.
  - `start_study_session`, `get_due_cards`, and `deck_stats` omit archived decks.
- **`unarchive_deck`:**
  - Clears `archivedAt` and resets `priority` to `"normal"` for target deck and its ancestors.

#### Tool: `rename_deck`
- Takes `{ deck: string, new_name: string }`.
- Parses `new_name` (e.g. `"Cardiology"` -> `"Medicine::Cardiology"`).
- Re-parents the deck under `Medicine` (creating `Medicine` if missing), updating `superDecks` and preventing cyclic references.

---

### 4.3 Study Session Tag Filtering (`app/src/server/mcpStudy.ts`)

Extend `start_study_session`:
```typescript
inputSchema: {
  type: "object",
  properties: {
    deck_id: { type: "string" },
    tag: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    card_limit: { type: "number" },
    new_limit: { type: "number" }
  }
}
```
- In `pickNext` and `snapshot`, filter candidate cards by checking that the associated note contains every tag in `tags` (AND intersection).

---

### 4.4 Speech Blocks & Multimodal Polish (`app/src/server/mcpNotes.ts`)

Card authoring schemas in `add_cards` and `edit_card` will accept optional speech blocks:
```typescript
export type SpeechBlock = 
  | { lang: string; text: string }
  | { say: "equation" | "look" };

export interface NoteContentSpeech {
  front_speech?: SpeechBlock[];
  back_speech?: SpeechBlock[];
}
```
- Preserves pronunciation hints (Kana for Kanji, Pinyin for Chinese, Spanish regional accents).
- Replaces unpronounceable math expressions with `{"say": "equation"}` and visual diagrams with `{"say": "look"}` so audio assistants do not read raw LaTeX/markup aloud.

---

### 4.5 Verbatim Note Type: `basic_typed`

Add note type `basic_typed` to `src/logic/type-implementations/`:
- **Fields:** `front`, `back`, `case_sensitive` (boolean, default false).
- **Study behavior:** `submit_review` compares learner's answer string directly against `back` and computes exact match and edit distance, instructing the assistant to grade strictly.

---

### 4.6 Interactive UI Study Panel Bridge (`app/src/server/mcpPanel.ts`)

Implements the 7 panel endpoints for clients supporting UI extensions:
1. `panel_cards`: Returns cards formatted for generative UI widgets.
2. `panel_show_answer`: Returns back HTML for display inside chat card widgets.
3. `panel_grade`: Handles rating button clicks from interactive UI panels.
4. `panel_edit_source`: Supplies raw note fields for modal edits in chat.
5. `panel_save_edit`: Commits in-place fixes directly from the chat widget.
6. `panel_archive`: Toggles archive state directly from the card widget.
7. `panel_reminders`: Saves user reminder preferences from panel prompts.

---

## 5. Implementation Phasing

1. **Phase 16.1: Deck Ergonomics & Pacing (Backend)**
   - `resolveDeckPath` with `Parent::Child` syntax.
   - `boost_new_today`, `get_limits`, `set_limits`.
   - `archive_deck`, `unarchive_deck`, `rename_deck`.
2. **Phase 16.2: Study & Note Enhancements**
   - Tag filtering in `start_study_session`.
   - `basic_typed` card type.
   - `front_speech` and `back_speech` metadata.
3. **Phase 16.3: UI Panels Bridge**
   - `mcpPanel.ts` and tool registration.
   - Integration tests with simulated generative UI callbacks.
