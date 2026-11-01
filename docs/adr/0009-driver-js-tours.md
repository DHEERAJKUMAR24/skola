# 0009. driver.js for guided tours, InfoTip for inline help

Date: 2026-11-01
Status: Accepted

## Context
The app must be self-explanatory for every module.

## Decision
Use driver.js (MIT, small, animated) for per-page tours defined in `src/components/Tour/tours.ts`, auto-started once with a synced `#toursSeen` setting. Use `InfoTip` (Popover API, top layer) for setting-level help.

## Consequences
New pages need a tour entry and tooltips. Closing a tour with X also marks it seen; users can replay from the profile menu.
