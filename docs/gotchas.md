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

