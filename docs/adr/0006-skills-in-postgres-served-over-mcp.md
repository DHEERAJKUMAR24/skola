# 0006. Agent skills live in Postgres and are served over MCP, llms.txt and a human page

Date: 2026-11-01
Status: Accepted

## Context
One skill should teach every assistant (Claude, ChatGPT, Codex and others) how to use Skola. The owner must be able to change it at any time without a deploy, and each user must be able to create or customise their own.

## Decision
Skills are Agent Skills folders (SKILL.md plus references) stored as rows in `skill_files` with an `owner`: the empty owner is the shared default, any other owner is a user's private set. A user's skill with the same name replaces the default for that user only. Edits keep the previous text in `skill_history`. Admins (`SKILL_ADMINS`) change the default; everyone changes their own, through MCP tools or `/skills/edit`.

Delivery: MCP tool `get_skill` (works in every client), resources under `skill://`, one prompt per skill and short server `instructions`; public `/llms.txt` (the product) and `/llms-skill.txt` (the skills, linked to each other), raw files and a zip for the defaults; `/skills` for humans. Only defaults are public.

## Consequences
Live edits need no deploy (public files cache about 30 seconds). The seed in code only fills an empty table. Skills over MCP resources follow a proposal (SEP-2640) that clients support unevenly, so the tool and prompt paths stay. Skill text is trusted content from the user or the admin, while card text returned by tools is data; the default skill says so.
