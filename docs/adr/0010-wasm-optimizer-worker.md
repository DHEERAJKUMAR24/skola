# 0010. Run the FSRS optimizer in the browser (fsrs-browser WASM, worker)

Date: 2026-11-01
Status: Accepted

## Context
Parameter optimization is heavy and the app is local-first and free-tier.

## Decision
Use fsrs-browser in a Web Worker, gated at 400 reviews, saving weights onto a preset.

## Consequences
Not yet verified on real history in a browser (see HANDOFF). Training uses study-day numbers for deltas.
