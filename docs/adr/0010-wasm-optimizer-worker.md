# 0010. Run the FSRS optimizer in the browser (fsrs-browser WASM, worker)

Date: 2026-11-01
Status: Accepted

## Context
Parameter optimization is heavy and the app is local-first and free-tier.

## Decision
Use fsrs-browser in a Web Worker, gated at 400 reviews, saving weights onto a preset.

## Consequences
Verified in Chrome on synthetic history. Training uses study-day numbers for deltas and one item per history prefix. The WASM uses threads, so the app is served cross-origin isolated (COOP same-origin, COEP credentialless); Safari cannot run it.
