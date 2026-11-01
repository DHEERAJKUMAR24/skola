import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "./db";
import { verifyLogin } from "./users";

/**
 * Auth.js only signs people in on this site (cookie session for the /oauth/authorize page).
 * API access uses the opaque OAuth tokens from ./oauth, not this session.
 */
export const { handlers, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(c) {
        try {
          const u = await verifyLogin(getDb(), String(c.email ?? ""), String(c.password ?? ""));
          return u ? { id: u.id, email: u.email } : null;
        } catch {
          return null; // locked or DB error: show the same generic failure
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = String(token.uid);
      return session;
    },
  },
});

/** The signed-in user's id for the current request, or null. */
export async function currentUserId() {
  const s = await auth();
  return (s?.user as { id?: string } | undefined)?.id ?? null;
}
