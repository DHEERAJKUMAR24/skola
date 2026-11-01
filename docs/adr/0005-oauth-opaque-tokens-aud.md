# 0005. Own OAuth 2.1 server with opaque, audience-bound tokens

Date: 2026-11-01
Status: Accepted

## Context
Future MCP clients (claude.ai) need standard OAuth, and tokens must identify who they are for (app vs MCP).

## Decision
Run our own OAuth 2.1 server: PKCE S256, opaque tokens stored as SHA-256 hashes, refresh rotation with replay revocation, RFC 8707 `resource` stored as `aud`, dynamic client registration. Do not use JWT access tokens.

## Consequences
Tokens can be revoked instantly. The MCP route validates in-process (no introspection endpoint). Tokens are in localStorage for now.
