# Handoff

Single source of truth for "where are we". Rewrite the sections below at the end of every session. Last updated: 2026-11-01.

## Repo state
- Repo: `DHEERAJKUMAR24/skola`, branch `next-migration`, last pushed commit `b2553e2` (study presets, optimizer, simulator, exam date, card controls, tours).
- Uncommitted when this was written: color picker redesign (`src/app/deck/DeckColorChooser.tsx|css`), InfoTip popover fix (`src/components/InfoTip/`), `usePresets` read-only array fix (`src/logic/deck/presets.ts`), and this docs/AGENTS.md/CLAUDE.md set. Run `git status`; commit only when the owner asks.
- Health: `pnpm lint:type` clean, `pnpm test` 107 passing in 18 files, `pnpm build` passes, Biome 18 warnings (17 upstream + 1 `role="radio"` on buttons).
- Not deployed to Vercel yet.

## Done (high level)
FSRS-6 with policy overlay; presets with easy days, leech, sibling burying, daily limits, new-card order, personal weights, simulator; exam dates with inheritance; card scheduling modal, tags, bulk actions; JS interview seed; Next.js + Supabase + Auth.js + OAuth server; sync of decks, cards, notes, settings, presets with debounced push and a countdown ring; InfoTip tooltips on preset and deck forms; driver.js tours for home, deck, learn, notes, presets.

## Unverified (do these before trusting the feature)
1. FSRS optimizer on a real person's history (it works on synthetic history in Chrome, see the 2026-11-02 log). Also Firefox, and Safari, which cannot run it (no COEP `credentialless`).
2. COOP/COEP headers: R2 pictures (needs real R2), the OAuth pages and the offline shell served by the service worker are not re-checked since the headers were added.
3. Two-device sync of presets and `#toursSeen`.
4. Tours on Deck, Learn and Presets pages (the Notes and Home tours were seen working).

## Next steps (ordered)
1. Commit and push the uncommitted work (ask the owner).
2. Verify the optimizer (item 1 above).
3. Add tooltips to deck page buttons, notes bulk bar, sidebar, study buttons.
4. Deploy: create Vercel project (root `app`, branch `next-migration`), env vars `DATABASE_URL`, `AUTH_SECRET` (new value), `APP_URL`, optional `ALLOW_SIGNUP`, `RESEND_API_KEY`, `EMAIL_FROM`; run `pnpm db:push`; smoke test sign-up, sync, reset email.
5. Phase 3 hardening (sync indicator states, tombstone gap, per-field merge), then Phase 4 media on R2.

6. MCP follow-ups: try `npx mcp-remote <APP_URL>/mcp` from Claude Desktop and `claude mcp add --transport http skola <APP_URL>/mcp` from Claude Code once deployed; consider a read-only scope and cloze support.

7. Skills: run `pnpm db:push` to apply `20261102000000_skills.sql`, set `SKILL_ADMINS` in Vercel, and improve the default skill text live at `/skills/edit` (the seed in `src/server/skillSeed.ts` only fills an empty table). Not yet done: the skill-creator eval loop (test prompts with and without the skill) and checking each assistant's install steps on the /skills page against its docs.

8. Offline: verified the production shell opens with the server stopped and that server pages show `/offline`. Not tried: creating and studying cards offline then syncing after reconnect on two devices; installing the PWA on a phone.

10. Study statistics now sync as `studySessions` (Dexie v27, server whitelist). The Statistics page is still the "temporarily removed" placeholder, so nothing displays them yet; `getStatistics` is ready for it. Not tried: two real devices.

11. Card types: cloze, multiple choice, list recall and image occlusion are built and were used end to end in the browser (create, study, edit). Not covered by tests: picture shrinking (`shrinkImage` needs a real browser; tried with one PNG), phone touch drawing of areas, and syncing a note with a picture between two devices. Fixed on the way: the Add Card button did nothing because `requestedFinish` was missing from a `useMemo` dependency list in `NewNotesView.tsx`; cloze edits now add cards for new deletions. The default skill row in a live database does not update itself: copy the new card-type text from `src/server/skillSeed.ts` into it at `/skills/edit`.

12. MCP now covers every card type: `add_cards` (image occlusion from `image_url` or base64; `image_url` is fetched only from public https hosts, no redirects, 400 KB cap, see `src/server/mcpImage.ts`), `edit_card` for all types, `get_card_image`. Verified by tests and one real download; not tried from Claude or ChatGPT. The live default skill needs the new text from `src/server/skillSeed.ts` pasted in at `/skills/edit`. The image fetch checks the address then fetches by name, so a hostile DNS server could in theory swap the answer (noted as a `shortcut:`).

13. (R2 bucket `skola-media` and its localhost CORS rule were created with wrangler on the owner's Cloudflare account; still to do: create the access key in the dashboard, fill the two key lines in `.env.local`, run `pnpm r2:check`, then set the four `R2_*` variables in Vercel and add the real origin to `scripts/r2-cors.json`.) Pictures now use R2 (see ADR 0007 and the dev guide). To switch it on you must create the bucket and token, set the four `R2_*` variables, add the CORS rule and run `pnpm db:push` (migration 20261103). Tested with a fake R2 that verifies signatures, including a second-device download; never run against real Cloudflare. Not done: deleting unused pictures, phone touch drawing of occlusion areas, Safari (WebP encoding may fall back to PNG).

14. Connect and install instructions are one guide (`src/server/connectGuide.ts`) rendered at `/skills` for people and at `/llms.txt` for agents. The Windows and macOS/Linux skill install commands were run for real against a local server. The per-assistant menu names (Claude, ChatGPT) come from their docs as I know them and change often: check them once against the real apps.

## Open questions for the owner
- Verified sending domain for Resend (needed for production reset emails).
- Vercel function region (suggest `bom1`, next to Supabase `ap-south-1`).
- Whether review logs and statistics should sync later (currently local only).

## Known issues
- Nested `<button>` hydration warning in the sidebar deck list (pre-existing, cosmetic).
- Closing a tour with X marks it seen.
- Tokens are in `localStorage`; no per-IP rate limit; no email verification at sign-up (see SPEC section 6.2).

## Session log
- 2026-11-03 (study sessions over MCP, uncommitted): new tools `start_study_session`, `next_card`, `show_answer`, `submit_review`, `end_session` (src/server/mcpStudy.ts, table `mcp_study_sessions`, migration `20261105000000_study_sessions.sql`). A session pins the open card and phase (asked, revealed, grading); `submit_review` needs the open card id and a prior `show_answer`, saves the review once (log id = hash of user, session, turn), and a retry returns the saved result with `duplicate: true`. A grade saved before the session update was lost is finished without grading again (`recovered`). Sessions expire after 2 hours idle. `grade_card` now calls the exported `gradeCard` (mcpWrite.ts). Skill text in skillSeed.ts now teaches sessions. NEEDS `pnpm db:push` on the live DB, and the live default skill row must be re-pasted at `/skills/edit`. Tested via JSON-RPC on PGlite (14 tests); not tested with a real MCP client or LLM. Known limit: two truly simultaneous identical submits are guarded by an update claim, not a row lock. Next slices: card CRUD and history, daily limits and goal date over MCP, semantic duplicates, K/S evidence, the four split skills.
- 2026-11-02 (image occlusion over MCP, uncommitted): new tools `get_capabilities`, `upload_image_asset`, `get_image_asset`, `preview_image_occlusion`, `create_image_occlusion_cards` (src/server/mcpOcclusion.ts, imageAssets.ts, imageInfo.ts). Pictures can arrive as base64, data URL, an https link, or a ChatGPT-style file reference `{download_url}` (downloaded with SSRF guards); an uploaded picture gets a stable `image_asset_id`. Areas are fractions 0 to 1, validated per area with the area number in the error. Idempotency keys make retries return the same cards; the write is one transaction. Errors carry a code like `[invalid_areas]`. `add_cards` accepts `image_asset_id` and file references too. NEEDS `pnpm db:push` (migration `20261104000000_image_assets.sql`, table `mcp_image_assets`) before upload works on the live database. Tested through the JSON-RPC handler on PGlite (21 tests); NOT tested with a real MCP client or a real LLM, and `_meta["openai/fileParams"]` (ChatGPT file inputs) is from memory of the Apps SDK docs and unverified. The live default skill row does not update itself: paste the new image-occlusion workflow from `src/server/skillSeed.ts` at `/skills/edit`.
- 2026-11-02 (branding, uncommitted): new "Skola++" logo (same green rounded square and inner border as the original, a bold S with two gold plus marks). Files: `public/logo.svg`, `app.svg`, `logo256.png`, `logo512.png`, new `logo-maskable512.png` (full-bleed for Android) and `apple-touch-icon.png`; manifest, layout metadata, sidebar, sign-in, welcome, offline, consent, skills page, tour and reset email now say Skola++. MCP `initialize` returns `serverInfo.title` "Skola++" and `icons` (from the request origin). `serverInfo.name` stays `skola`, and the skill and tool ids are unchanged, so existing connections and installed skills keep working. ChatGPT and Claude set their own app icon in their own settings; upload `logo512.png` there. `badge.svg` and `public/404.html` still show the old look.
- 2026-11-02 (v0.4.1): ChatGPT connector failure fixed. Root cause is in gotchas (MCP and CORS). The CORS widening in 0.4.0 was real but not the cause. v0.4.0 deployed to production on `dj-1b1f` (owner zero2); the user must remove and re-add the app in ChatGPT.
- 2026-11-02 (mcp cors): "authentication successful, action discovery failed" traced to the `/mcp` CORS preflight allowing only `content-type, authorization`. Widened (new `src/server/cors.ts`), 401 now has CORS headers, `www-authenticate` and `mcp-session-id` exposed, `mcpHttp.test.ts` added, checked with curl against dev. Not confirmed on the client that failed (ChatGPT and Claude web are server-side, so CORS would not explain those); not deployed.
- 2026-11-02 (verify, round 2): ran the production build (`pnpm start`, port 3003) and dev (3002) in headless Chrome over CDP with the JS sample: study flow with Again/Hard/Good/Easy keys (shown interval equals stored due, reps +1, lapse counted, a review log per answer), deck and card details modals, optimizer in the prod bundle, COOP/COEP headers on `/`, `/offline`, `/sw.js`, `/skills`, a cross-origin image still loads. "View details" menu items no longer need developer mode. Service worker did not register in headless Chrome, so the offline shell under COEP is unchecked.
- 2026-11-02 (verify): optimizer was broken in a real browser, two causes. (1) fsrs-browser needs a cross-origin isolated page: added COOP/COEP headers. (2) `buildTrainingSet` sent one item per card; the trainer wants one item per history prefix and no all-same-day items: fixed, test updated. Verified end to end in headless Chrome over CDP (synthetic 2676 reviews, 21 weights saved). Simulator checked against an independent Monte Carlo reference (`simulate.reference.test.ts`). The synthetic seed script is not kept; it wrote `reviewLogs` rows with ids `syn-*` into a throwaway browser profile only.
- 2026-11-02 (fsrs audit): added `scheduling/lifecycle.test.ts` (15 cases: state flow, retention property, caps, whole-day, fuzz, exam) and `scheduling/summary.ts`. Card and deck "View details" modals now show schedule (next intervals per answer, due per day, overdue, memory averages). Not checked in a browser.
- 2026-11-01 (skills): agent skills in Postgres with default + per-user skills, full CRUD over MCP, llms.txt, /skills pages, live editor; verified with a real OAuth login.
- 2026-11-01 (later): deck menu study/practice items, deck priority (paused decks skipped in study), MCP server with 10 tools, verified with a real OAuth flow. Pure helpers `deck/effectiveOptions.ts` and `note/tagNormalize.ts` split out so the server can import them without Dexie.
- 2026-11-01: presets, FSRS options, optimizer, simulator, tours, tooltips, color picker, popover tooltip fix, preset sort fix, docs restructure (AGENTS.md, ADRs, HANDOFF).
