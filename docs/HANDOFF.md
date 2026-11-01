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
1. FSRS optimizer on real history in a browser (WASM worker under Next webpack; needs 400+ reviews). Method: insert synthetic `reviewLogs` with fake card ids through raw IndexedDB, run Optimize in Settings > Study presets, then delete them.
2. Workload simulator output against a known reference.
3. Two-device sync of presets and `#toursSeen`.
4. Tours on Deck, Learn and Presets pages (the Notes and Home tours were seen working).

## Next steps (ordered)
1. Commit and push the uncommitted work (ask the owner).
2. Verify the optimizer (item 1 above).
3. Add tooltips to deck page buttons, notes bulk bar, sidebar, study buttons.
4. Deploy: create Vercel project (root `app`, branch `next-migration`), env vars `DATABASE_URL`, `AUTH_SECRET` (new value), `APP_URL`, optional `ALLOW_SIGNUP`, `RESEND_API_KEY`, `EMAIL_FROM`; run `pnpm db:push`; smoke test sign-up, sync, reset email.
5. Phase 3 hardening (sync indicator states, tombstone gap, per-field merge), then Phase 5 MCP, then Phase 4 media on R2.

## Open questions for the owner
- Verified sending domain for Resend (needed for production reset emails).
- Vercel function region (suggest `bom1`, next to Supabase `ap-south-1`).
- Whether review logs and statistics should sync later (currently local only).

## Known issues
- Nested `<button>` hydration warning in the sidebar deck list (pre-existing, cosmetic).
- Closing a tour with X marks it seen.
- Tokens are in `localStorage`; no per-IP rate limit; no email verification at sign-up (see SPEC section 6.2).

## Session log
- 2026-11-01: presets, FSRS options, optimizer, simulator, tours, tooltips, color picker, popover tooltip fix, preset sort fix, docs restructure (AGENTS.md, ADRs, HANDOFF).
