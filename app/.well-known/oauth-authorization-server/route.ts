import { json, preflight } from "@/server/http";
import { audiences, origin } from "@/server/oauth";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

// RFC 8414 authorization server metadata.
export function GET(req: Request) {
  const o = origin(req);
  return json({
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    revocation_endpoint: `${o}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["sync", "mcp"],
    resource_indicators_supported: true,
    authorization_response_iss_parameter_supported: true,
    resources: Object.values(audiences(o)),
  });
}
