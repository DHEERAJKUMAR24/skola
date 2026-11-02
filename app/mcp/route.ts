import { getDb } from "@/server/db";
import { json, preflight } from "@/server/http";
import { handleRpc } from "@/server/mcp";
import { audiences, authenticate, origin, unauthorized } from "@/server/oauth";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

// Streamable HTTP, stateless, JSON replies only. Read-only tools for now.
export async function POST(req: Request) {
  const o = origin(req);
  const db = getDb();
  const who = await authenticate(db, req, audiences(o).mcp);
  if (!who || !who.scope.split(" ").includes("mcp"))
    return unauthorized(o, "/mcp");

  const body = await req.json().catch(() => null);
  if (!body)
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      400
    );

  const batch = Array.isArray(body);
  const replies = (
    await Promise.all(
      (batch ? body : [body]).map((m: object) => handleRpc(db, who.userId, m))
    )
  ).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return json(batch ? replies : replies[0]);
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
