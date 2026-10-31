import { Pool } from "pg";

export type Query = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<{ rows: T[] }>;

/** Minimal Postgres surface the sync code needs, so tests can swap in PGlite. */
export interface Db {
  query: Query;
  transaction<T>(fn: (query: Query) => Promise<T>): Promise<T>;
}

// Kept on globalThis: Next bundles routes separately and reloads modules in dev, which would open many pools.
const g = globalThis as unknown as { __skolaPool?: Pool };

export function getPool(): Pool {
  if (!g.__skolaPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    // max 1: each serverless instance handles one request at a time; Neon's pooler fans in.
    g.__skolaPool = new Pool({ connectionString, max: 1 });
  }
  return g.__skolaPool;
}

export function pgDb(p: Pool): Db {
  return {
    query: (text, params) => p.query(text, params as unknown[]) as never,
    async transaction(fn) {
      const client = await p.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(
          (text, params) => client.query(text, params as unknown[]) as never
        );
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

export const getDb = () => pgDb(getPool());
