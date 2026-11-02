/**
 * Public OAuth and MCP endpoints use PKCE and bearer tokens, no cookies, so any origin may call them.
 * Browser MCP clients (Inspector, web apps) also send the MCP headers and read the 401 challenge,
 * so those headers must be allowed and exposed or tool discovery fails after sign-in succeeds.
 */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "content-type, authorization, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
  "access-control-max-age": "86400",
};
