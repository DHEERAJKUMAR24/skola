CREATE TABLE IF NOT EXISTS changes (
  user_id    text    NOT NULL,
  tbl        text    NOT NULL,
  id         text    NOT NULL,
  data       jsonb,
  updated_at bigint  NOT NULL,
  deleted    boolean NOT NULL DEFAULT false,
  seq        bigint  NOT NULL,
  PRIMARY KEY (user_id, tbl, id)
);
CREATE INDEX IF NOT EXISTS changes_seq ON changes (user_id, seq);

CREATE TABLE IF NOT EXISTS users (
  id            text   PRIMARY KEY,
  email         text   NOT NULL UNIQUE,
  password_hash text   NOT NULL,
  failed_logins int    NOT NULL DEFAULT 0,
  locked_until  bigint NOT NULL DEFAULT 0,
  created_at    bigint NOT NULL
);

-- One pending reset per email; otp_hash is an HMAC, never the code itself.
CREATE TABLE IF NOT EXISTS password_resets (
  email      text   PRIMARY KEY,
  otp_hash   text   NOT NULL,
  expires_at bigint NOT NULL,
  sent_at    bigint NOT NULL,
  attempts   int    NOT NULL DEFAULT 0
);

-- Dynamically registered OAuth clients (public clients only, PKCE required).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     text   PRIMARY KEY,
  name          text   NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at    bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      text   PRIMARY KEY,
  client_id      text   NOT NULL,
  user_id        text   NOT NULL,
  redirect_uri   text   NOT NULL,
  code_challenge text   NOT NULL,
  aud            text   NOT NULL,
  scope          text   NOT NULL,
  expires_at     bigint NOT NULL
);

-- Opaque tokens: only SHA-256 hashes are stored. aud is the resource the token is valid for.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                 text   PRIMARY KEY,
  client_id          text   NOT NULL,
  user_id            text   NOT NULL,
  aud                text   NOT NULL,
  scope              text   NOT NULL,
  access_hash        text   NOT NULL UNIQUE,
  access_expires_at  bigint NOT NULL,
  refresh_hash       text   NOT NULL UNIQUE,
  prev_refresh_hash  text,
  refresh_expires_at bigint NOT NULL,
  revoked_at         bigint
);
CREATE INDEX IF NOT EXISTS oauth_tokens_user ON oauth_tokens (user_id);
