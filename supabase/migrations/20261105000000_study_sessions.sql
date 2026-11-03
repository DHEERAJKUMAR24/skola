-- Study sessions for AI agents over MCP. A session pins which card is being asked (current_card_id),
-- whether its answer was shown (phase) and the last graded answer (last_review), so a review can
-- never land on the wrong card or twice when a client retries. `seen` holds the skipped card ids.
-- Server-only: never synced to devices.
CREATE TABLE IF NOT EXISTS mcp_study_sessions (
  user_id         text    NOT NULL,
  id              text    NOT NULL,
  deck_id         text,
  card_limit      integer NOT NULL,
  new_limit       integer NOT NULL,
  seen            jsonb  NOT NULL DEFAULT '[]',
  new_served      integer NOT NULL DEFAULT 0,
  current_card_id text,
  turn            integer NOT NULL DEFAULT 1,
  phase           text    NOT NULL DEFAULT 'asked',
  pending_rating  integer,
  reviewed        integer NOT NULL DEFAULT 0,
  skipped         integer NOT NULL DEFAULT 0,
  ratings         jsonb   NOT NULL DEFAULT '{}',
  last_review     jsonb,
  started_at      bigint  NOT NULL,
  updated_at      bigint  NOT NULL,
  expires_at      bigint  NOT NULL,
  ended_at        bigint,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE mcp_study_sessions ENABLE ROW LEVEL SECURITY;
