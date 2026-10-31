import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { getPool } from "./db";

function createAuth() {
  const pool = getPool();
  const vercelHosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
  ]
    .filter(Boolean)
    .map((h) => `https://${h}`);

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: vercelHosts,
    database: pool,
    emailAndPassword: { enabled: true },
    // bearer: the client keeps the token itself, which also works for the MCP endpoint later.
    plugins: [bearer()],
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            // "false" closes sign-up once the first account exists.
            if (process.env.ALLOW_SIGNUP !== "false") return;
            const r = await pool.query('SELECT COUNT(*)::int AS n FROM "user"');
            if (r.rows[0].n > 0)
              throw new APIError("FORBIDDEN", { message: "Sign-up is closed" });
          },
        },
      },
    },
  });
}

const g = globalThis as unknown as {
  __skolaAuth?: ReturnType<typeof createAuth>;
};

/** Lazy so `next build` can import route modules without DATABASE_URL set. */
export const getAuth = () => (g.__skolaAuth ??= createAuth());
