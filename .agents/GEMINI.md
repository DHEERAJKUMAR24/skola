# Gemini Assistant Guidelines

Always read and enforce:
1. [Universal Agent Guidelines](file:///D:/Workspace/z-personalWorkspace/skola/.agent/rules/coding_guidelines.md)
2. All plans, designs, comparisons, and specs **must be saved as persistent markdown files in `app/docs/`**.
3. Respect all FSRS scheduling invariants, Dexie immutability rules, and Popover modal rules.
4. Definition of done before finishing: `pnpm exec biome check --write && pnpm lint:type && pnpm test`.
