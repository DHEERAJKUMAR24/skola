import { getDb } from "@/server/db";
import { AuthError, createUser } from "@/server/users";

export const dynamic = "force-dynamic";

const STATUS = { invalid: 400, weak: 400, exists: 409, closed: 403, locked: 429 } as const;

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  try {
    await createUser(getDb(), String(b?.email ?? ""), b?.password);
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return Response.json({ error: e.message }, { status: STATUS[e.code] });
    console.error(e);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
