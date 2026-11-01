import { json, preflight } from "@/server/http";
import { audiences, origin } from "@/server/oauth";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

// RFC 9728 protected resource metadata. `/.well-known/oauth-protected-resource/mcp` describes the MCP resource.
export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const o = origin(req);
  const { path } = await ctx.params;
  const known = audiences(o);
  const requested = path?.length ? `${o}/${path.join("/")}` : known.api;
  const resource = requested === known.mcp ? known.mcp : known.api;
  return json({
    resource,
    authorization_servers: [o],
    scopes_supported: [resource === known.mcp ? "mcp" : "sync"],
    bearer_methods_supported: ["header"],
  });
}
