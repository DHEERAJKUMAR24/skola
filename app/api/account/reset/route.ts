import { getDb } from "@/server/db";
import { confirmReset } from "@/server/reset";
import { AuthError } from "@/server/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  try {
    await confirmReset(
      getDb(),
      String(b?.email ?? ""),
      String(b?.otp ?? ""),
      b?.password
    );
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
