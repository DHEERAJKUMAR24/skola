# Ask AI: copy a prompt and open your assistant (design)

- **Status:** DESIGN, waiting for the owner's approval (2026-11-07). Nothing is built.
- **Phase:** 24 in `docs/SPEC.md`. Shared by Phase 22 (`spec-targeted-review.md`) and Phase 23 (`spec-master-card.md`); it was first sketched inside Phase 23 and is moved here so both use one mechanism.
- **Research:** link formats in `docs/research-master-card-visual-revision.md` section 3.

## 1. Intent

Skola has no AI of its own and never will hold an AI key. Anything that needs an AI in the app (drafting fused questions, drafting a diagram, writing cards from a source, rewriting a card that keeps failing) works like this: **an "Ask AI" button builds the instruction, copies it, and opens the user's own assistant, which does the work through Skola's MCP server. The result syncs back and shows up in the app.** The human never has to know prompt syntax, and the AI never needs the app open.

Every feature that needs an AI must therefore have **three doors**: the human UI, the MCP tools, and the Ask AI button that connects them.

## 2. Goals

- One pure prompt builder, one button, one list of assistants, used everywhere.
- Prompts carry only the action and ids: no names, no card text, no secrets, short enough for a link.
- Copy first, always; open the assistant only if a link format is known and the prompt fits.
- Works signed out of nothing: the app does not need to know which assistant, and does not call any AI endpoint.

## 3. Non-goals

- Calling any AI API from the app, or storing a key.
- Knowing whether the assistant did the work (the app only shows data when it arrives).
- Streaming the assistant's reply into the app.
- Building a chat window.

## 4. Anti-goals

- Putting card contents or personal data in a URL (links can be logged and cached).
- A prompt so clever that it only works in one assistant.
- A button that looks like the app did the work itself.

## 5. Constraints

- Local-first, no cron, no new server tables.
- The assistant must already be connected to Skola's MCP server; the prompt says so and links to the connect page (`/skills`).
- Prefill links are unofficial and can change (research doc), so targets are a user-editable list and copy-only is always available.

## 6. Design

### 6.1 The button

`<AskAiButton action="fusion.draft" context={{ deckId }} />`: a small menu button, "Ask AI", with a dropdown of the user's assistants plus "Copy prompt". One click on an assistant: copy, then open. Shown next to the thing it acts on (a master, the targeted-review page, the new-note page, a stuck card).

```
[ Ask AI v ]
   Claude (desktop)
   Claude (web)
   ChatGPT
   Gemini  (copy, then paste)
   Copy prompt only
   Manage assistants...
```

After the click a toast says what happened: "Prompt copied and Claude opened", or "Prompt copied. Paste it into Gemini." It also shows the one-line reminder "Your assistant needs the Skola connector" with a link to `/skills` the first time.

### 6.2 The prompt

Pure builder `src/logic/ai/prompts.ts`: `buildPrompt(action, ctx, origin)` returns plain text. Shape:

```
Use the Skola MCP tools (not connected? see <origin>/skills).
First read the skill "<skill name>" with get_skill and follow it.
Task: <one sentence for this action>.
Target: master id m_123 in deck id d_9.
Before you write anything, show me what you plan to write and wait for my yes.
```

- **Ids only: no names, no card text.** Names can be personal and links can be logged or cached, so a prompt carries the kind and id of what it acts on (master m_123, deck d_9); the assistant reads names and contents over MCP. The copied text is the same as the link text.
- **Approval is per action, not global.** The last prompt line asks the assistant to show its plan and wait for a yes in the chat. Only `fusion.draft` also saves its result as pending drafts that the learner approves in the app (Phase 22). Every other action writes directly after that yes, so the server cannot prove a person approved it; edits to notes and masters can be undone from the note history (7 days today, 90 days after Phase 16.2).
- Each action names the tool or skill step it expects, so the prompt and the skill cannot drift: the builder reads the action list from one table in `src/logic/ai/actions.ts`, and a test checks each action's skill name and tools exist in `src/server/skillSeed*.ts` and `TOOLS`.
- Length: the encoded prompt must fit the target's `maxChars`; the builder shortens by dropping optional lines, never by cutting ids.

### 6.3 Actions (first set)

| Action | Used on | Skill and tools the prompt names | Result in the app |
|---|---|---|---|
| `fusion.draft` | targeted review page (Phase 22) | `skola` fusion step; `list_targeted_review`, `draft_fusions` | "Drafts to approve" list |
| `card.rewrite_stuck` | a stuck card (Phase 22) | `skola-card-architect`; `get_card_details`, `edit_card` | the card is edited; run resets on save |
| `master.draft_diagram` | master builder (Phase 23) | `skola` diagram step; `get_master_card`, `update_master_card` op `set_edges` | arrows appear in the builder for the learner to review |
| `master.fill_gaps` | Gaps panel of a master | `skola-quality-auditor`; `master_coverage`, then `update_master_card` | entries or cards added only after approval |
| `master.build_from_cards` | master builder | `skola-card-architect`; `create_master_card from_deck` | a new master |
| `master.relations` | arrow panel and Gaps panel | `skola`; `get_master_card`, `update_master_card` op `set_relation_cards` | relation cards for the arrows that matter |
| `cards.add_variety` | entry panel and Gaps panel | `skola-card-architect`; `get_master_card`, `find_similar_cards`, `add_cards` | cloze and multiple-choice cards for entries with only basic cards |
| `cards.from_source` | new-note page | `skola-card-architect`; `add_cards` | new cards |
| `master.session` | master sheet, Session button | `skola` session-in-chat step; `start_study_session` with `master_id`, `submit_review` | reviews on the cards linked from the master |

More actions are one row in the table, plus one skill step.

### 6.4 Assistants list

Synced setting `#aiTargets`: `{ id, label, urlTemplate?, maxChars? }[]`, `{prompt}` inside the template, URL-encoded by the app. Defaults (research, 2026-11-07):

| Label | Template | Notes |
|---|---|---|
| Claude (desktop) | `claude://claude.ai/new?q={prompt}` | official, about 14,000 characters |
| Claude (web) | `https://claude.ai/new?q={prompt}` | unreliable, marked untested |
| ChatGPT | `https://chatgpt.com/?q={prompt}` | community-reported, `maxChars` 2000, untested |
| Perplexity | `https://www.perplexity.ai/?q={prompt}` | community-reported, untested |
| Grok | `https://grok.com/?q={prompt}` | community-reported, untested |
| Gemini, Copilot, Mistral | bare site URL, no `{prompt}` | copy only |

The user can edit, add, reorder or delete targets in Settings, AI assistants tab (which already exists for instructions). A "Test" button opens a harmless test prompt so the user learns whether the link format works for them; a pass is stored per device as `localStorage["aiTargetTested.<id>"]` (it is not part of the synced setting).

### 6.5 Flow

1. Build the prompt.
2. `navigator.clipboard.writeText` (fallback: a selectable text box in a small dialog if the clipboard is blocked).
3. If the target has a template and the encoded prompt fits `maxChars`: `window.open(url, "_blank", "noopener")`. Otherwise open the bare site if there is one, or stop at the copy.
4. Toast as in 6.1.

No network request is made by the app. Nothing is stored except the setting.

### 6.6 Human UI, AI and the button, for each use

| Need | Human UI | MCP (the assistant) | Ask AI |
|---|---|---|---|
| draft fused questions | write one yourself on the page | `draft_fusions` | `fusion.draft` |
| diagram | edge editor in the builder | `update_master_card set_edges` | `master.draft_diagram` |
| new cards from a source | note editor | `add_cards` | `cards.from_source` |
| rewrite a stuck card | editor | `edit_card` | `card.rewrite_stuck` |
| test a master | Session through `/learn/.../master.<id>` | study session over the master's cards | `master.session` |

Rule for every future AI feature: it is not done until all three columns exist.

### 6.7 Fit with the app (checked against the code)

- **Settings:** the synced `settings` table is a set of keyed rows (key path `key`). Nothing whitelists setting names on the server (`src/server/sync.ts` whitelists tables only), so `#aiTargets` needs no schema or server change. It does need an entry in `SettingsValues` and `defaultSettings` (`src/logic/settings/`), which is a closed interface that `useSetting` is typed against.
- The assistants editor goes on the existing Settings, AI assistants tab (`src/app/settings/`), next to the instructions editor. **`tested` is per device** (kept in `localStorage` keyed by target id, not in the synced setting): a `claude://` link that works on a desktop does not work on a phone, so a pass on one device must not mark it tested on another.
- **Popover API:** the Ask AI menu is also opened from inside modals (Gaps panel, gap hunt), so it uses the Popover API (top layer), as AGENTS.md requires; `z-index` loses to `<dialog>`.
- **Names stay in sync by a test, not by sharing code.** Tool and skill names are string literals inside the `Tool` objects (`src/server/mcp*.ts`) and `SEED_SKILLS` (`skillSeed.ts`); there is no shared constants file, and importing those server files into `src/logic/ai/` would drag server-only code into the client bundle. So `src/logic/ai/actions.ts` holds its own literals, and a `// @vitest-environment node` test imports `TOOLS` (an array: names come from `TOOLS.map(t => t.name)`) and `SEED_SKILLS` (which includes `LEARNING_SKILLS`) and fails when an action names a tool or skill that does not exist. **Ops are not tools:** `set_edges`, `set_relation_cards` and the like are ops described inside the `update_master_card` description, so for those the test checks that description text. A "skill step" cannot be checked by name, so each action carries a short marker phrase that the test looks for in the skill text. **Rows are added only when their tools exist:** `list_targeted_review` and `draft_fusions` belong to Phase 22, so the `fusion.draft` action is added with Phase 22, not before.
- **Skill delivery:** skill seed text only reaches an empty database (`adr/0006-skills-in-postgres-served-over-mcp.md`). The owner's live default skill is changed by hand at `/skills/edit` or with `update_skill_file` (scope `default`). Acceptance for every skill step an action names: `get_skill` returns the marker phrase.
- Clipboard: `navigator.clipboard.writeText` needs a user gesture and a secure origin; both hold for a click in the PWA. The fallback dialog covers a blocked clipboard (a dialog with the prompt selected; acceptance: it appears when the write rejects).
- Opening links: `window.open(url, "_blank", "noopener")`. Custom schemes such as `claude://` may do nothing without the desktop app; the toast says so and copy still worked.
- **Shortening to fit a link (`maxChars`):** the builder drops optional lines in this order until the encoded link fits: the deck id line, then the "not connected? see" hint. The target id and the task sentence are never cut. If it still does not fit, the link is not opened (copy only, with the toast). Acceptance: a test with a long task text.
- i18n: prompts are English on purpose (assistants and the MCP tools are English); the button, toasts and settings labels go through `t()`.
- **InfoTips and tours:** the Ask AI button, the assistants list, and each Test button get an `InfoTip`; the assistants editor is part of the existing settings tour step.

## 7. What changes where

| Area | Change |
|---|---|
| `src/logic/ai/actions.ts`, `prompts.ts` (new) | action table with its own name literals and marker phrases, prompt builder |
| `src/logic/ai/actions.test.ts` (new, node environment) | every named tool is in `TOOLS`, every skill in `SEED_SKILLS`, every marker in the skill text; length rule; no card text in any prompt |
| `src/components/AskAi/` (new) | button, menu, toast, clipboard fallback dialog |
| `src/logic/settings/` | `#aiTargets` in `SettingsValues` and `defaultSettings`, defaults in code |
| `src/app/settings/` (AI assistants tab) | the editor and a Test button |
| `src/server/skillSeed.ts` (`skola`) and `skillSeedLearning.ts` (`skola-*`) | the steps the prompts name; then update the live skills |
| tours, InfoTips, `docs/features.md`, HANDOFF, SPEC row | updated with the build |

No server migration, no Dexie version, no new API route.

## 7b. Build order and done criteria

1. Prompt builder, action table and tests (no UI). *Done when* the node test passes against the real tools and skills.
2. Button, menu, copy and open, fallback dialog, `#aiTargets` defaults. *Done when* copy works, the fallback dialog appears when the clipboard rejects, a too-long link is not opened, and the toast says what happened.
3. Assistants editor and Test button in Settings. *Done when* a target can be added, edited, reordered and deleted, and a Test marks it tested.
4. Actions are added with the features that use them (Phases 22 and 23), each with its skill step delivered to the live skill.
Copy-only is always the minimum definition of done: if a link format stops working, the feature still works.

## 8. Calls I made

1. One shared mechanism and one doc, not a copy per feature.
2. The action table is the single source for prompt text, skill names and tools, checked by a node test against the real skills and tools.
3. Copy first, open second; never both silently failing.
4. All unofficial link formats are marked untested until the user's Test button passes.
5. The three-doors rule (human, MCP, Ask AI) is the definition of done for AI features.
6. Approval is per action (see 6.2), not a global promise.

## 9. Later ideas

- A "paste the AI's answer back" box for assistants that cannot use MCP.
- Per-action default assistant.
- Sharing a tested target list between devices is already covered by the synced setting.
