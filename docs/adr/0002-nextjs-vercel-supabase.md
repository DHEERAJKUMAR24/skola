# 0002. Next.js on Vercel with Supabase Postgres

Date: 2026-11-01
Status: Accepted

## Context
The first backend was a Cloudflare Worker with D1. The owner wanted Vercel free hosting, Next.js, a PWA and local-first behavior, with Postgres they can inspect.

## Decision
Run the SPA client-only inside a Next.js catch-all route (hash router) and implement the API as Next route handlers. Store server data in Supabase Postgres via `pg` and the transaction pooler; schema through Supabase CLI migrations; RLS on all tables. The Worker, D1 and `worker/` folder were deleted.

## Consequences
One deploy target. Supabase Free pauses after about a week idle. Vercel Hobby is non-commercial only. Function region should sit near the database.
