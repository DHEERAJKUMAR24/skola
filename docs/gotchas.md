# Gotchas

- **Dexie live-query results are read-only in dev.** Copy before sorting: `[...rows].sort(...)`. Hit in `usePresets` when a second preset existed.
- **`z-index` cannot beat a modal `<dialog>`** (top layer). Use the Popover API (`popover="manual"` + `showPopover()`) for floating UI over modals.
- **ts-fsrs does not enforce `maximum_interval`** in all paths; the policy overlay caps it.
- **Training deltas** must use study-day numbers, not `floor(elapsed days)`.
- **Service worker only exists in a production build.** Test offline with `pnpm build`, the `skola-next-prod` preview (port 3001), load `/` once, stop the server, then reload. Unregister the worker afterwards or a stale one will answer on that port.
- **`reloadOnOnline` must stay false** in `next.config.mjs`; the Serwist default reloads the page when the connection returns, which would interrupt studying.
- **Race on first run:** `ensureDefaultPreset` can be called twice; the duplicate add error is swallowed on purpose.
- **Settings sync** needs `updatedAt` on settings rows (Dexie v26 backfill) and key path `key`.
- **Order of side effects:** roll back before throwing in OTP and refresh-token flows; reject login cookies for users that no longer exist.
- **Tour seen flag** is written on destroy, including closing with X and re-running a tour.
- **Next dev + HMR** can leave the page unstyled after large edits; navigate to a fresh URL.
- **`role="status"`** triggers Biome; use `<output>`.
- **Removed exports:** `FSRS_DEFAULTS` stays only in `fsrsOptions.ts` for tests; `toFormState`/`fromFormState`/`DeckFsrsFields` are gone, use `examForm.ts` and `DeckStudyFields`.

## Optimizer (fsrs-browser)
- `computeParameters` panics with `unreachable` on bad input. The real message (`NotEnoughData`, `Invalid FSRS item: at least one review with delta_t > 0 is required`) goes to the worker console only. To debug, temporarily override `console.error` in `optimizer.worker.ts` and return it in the error.
- Without cross-origin isolation `initThreadPool` throws "SharedArrayBuffer transfer requires self.crossOriginIsolated". The headers live in `next.config.mjs`; a new cross-origin embed (iframe, no-cors image) may need CORS or CORP once it is on.
- Rows seeded with raw IndexedDB do not wake Dexie live queries: reload the page.

## MCP and CORS
- Browser MCP clients (Inspector, web apps) send `mcp-protocol-version`, `mcp-session-id` and `accept` after `initialize` and read `WWW-Authenticate` from the 401. `src/server/cors.ts` allows and exposes them, and `unauthorized()` carries the CORS headers. If sign-in works but tool discovery fails, check the preflight first. `mcpHttp.test.ts` covers it. The server is stateless (it never issues a session id).
- ChatGPT "Authentication succeeded, action discovery failed" (2026-11-02): the 401 from `/mcp` pointed `resource_metadata` at the root metadata URL, which describes the `/api` resource. ChatGPT follows that URL, asks for a token for `/api`, gets one (scope `sync`), and `/mcp` then rejects it with 401. Fixed: `unauthorized(o, "/mcp")` points at `/.well-known/oauth-protected-resource/mcp`. A connection made before the fix holds `/api` tokens; delete the app in ChatGPT and connect again. To diagnose: `vercel logs requests --since 1h` (look for `POST /oauth/token` 200 followed by `POST /mcp` 401) and compare `aud` in `oauth_tokens`.

## Image occlusion over MCP
- A ChatGPT file reference is an object (`download_url`, `file_id`), not bytes. Skola only downloads `download_url`; a bare `file_id` cannot be read and gives `[unsupported_image_reference]`.
- Without R2 keys a card keeps the picture inline, so it is capped at 400 KB (`[image_too_large_for_inline]`). Uploaded assets (up to 8 MB) are only the staging copy in `mcp_image_assets`; the card copies the bytes (to R2 or inline).
- `idempotency_key` makes the note and card ids deterministic (hash of user, key, part) and stores a request hash in `note.mcpRequest`. Same key with other content gives `[idempotency_conflict]`.
- Coordinates are fractions, so resizing a picture can never shift an area; do not add a pixel mode.


## MCP evidence, history and skills (0.6.0)
- **Edit history pruning keeps the version just saved.** Deleting everything older than 7 days would empty the history of a note last edited long ago. Keep that rule when touching `noteHistory.ts`.
- **Day labels use local date parts.** `deck_schedule` once used UTC and showed the wrong day in timezones ahead of UTC (`localDate()` in `mcpManage.ts`).
- **`ensureSeed` only tops up.** It adds built-in skills that never existed in a used table, never overwrites edits and never brings back deleted ones. The old default `skola` row is not updated: re-paste it at `/#/settings/skills`.
- **A local dev server on `.env.local` writes to the live database.** It top-up-seeded the four learning skills there once. Use a scratch database for experiments.
- **`ts` regex `s` flag is not available** with the current target; use `[\s\S]`.
- **Instructions semantics:** `undefined` = default, `""` = none on purpose, reset = tombstone row. Do not treat empty as default.

## App screens for server-only data (2026-11-06)
- **Restore vs unsent edits:** a restore is written on the server; a device with an older unsent local copy of the note would overwrite it on its next push. `NoteHistoryModal` runs `syncNow()` before it loads and after it restores. Keep that order.
- **jsdom has no Popover or dialog methods:** component tests that open `Select` or `Modal` must stub `HTMLElement.prototype.hidePopover/showPopover` and `HTMLDialogElement.prototype.showModal/close` (see `Objectives.test.tsx`, `NoteHistoryModal.test.tsx`).
- **App routes call MCP tools:** `appApi.ts` returns array results as `{ items }`, and tool errors `[code] message` become HTTP 4xx with `{ error, code }`. A rename of a tool in `mcpManage.ts` or `mcpEvidence.ts` must be followed in `HISTORY_OPS` and `OBJECTIVE_OPS`.

## Master cards over MCP (2026-11-06)
- **`get_master_card` changed meaning.** It used to alias `get_objective_overview`; now it reads a real master. Old callers passing `objective_id` get `[renamed_tool]`. Do not re-add the alias.
- **A master's study cards are managed by the plan.** `delete_cards` refuses them (`[master_card]`) and `edit_card` refuses content edits; use `delete_master_card` and `update_master_card`. `restore_card_version` re-plans the cards after restoring text.
- **Server card ids for a master:** deterministic only for `create_master_card` with an `idempotency_key`; later study cards from `update_master_card` get random ids (a deleted card's tombstone must not be reused).
- **Coverage counts the master's own deck only**, ignoring other masters' cards; moving a master (`move_cards`) changes which deck it is measured against.
- **The server never imports `NoteType` from `src/logic/note/note.ts`** (it pulls in UI note types); use the string `"master"` (`MASTER_TYPE` in `mcpMaster.ts`).
