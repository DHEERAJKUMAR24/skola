-- Learning objectives and the dated K/S evidence behind them (Knowledge and Skill, four dimensions
-- each, rated 0 to 4). Server-only for now: written and read over MCP, never synced to devices.
CREATE TABLE IF NOT EXISTS learning_objectives (
  user_id     text   NOT NULL,
  id          text   NOT NULL,
  deck_id     text,
  title       text   NOT NULL,
  description text,
  priority    text   NOT NULL DEFAULT 'P1',
  track       text   NOT NULL DEFAULT 'KS',
  status      text   NOT NULL DEFAULT 'active',
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- Which cards practise an objective. One objective can have many cards; a card can serve several.
CREATE TABLE IF NOT EXISTS objective_cards (
  user_id      text   NOT NULL,
  objective_id text   NOT NULL,
  card_id      text   NOT NULL,
  linked_at    bigint NOT NULL,
  PRIMARY KEY (user_id, objective_id, card_id)
);

-- Append-only evidence. The text of the answer or result is kept, not only the number.
CREATE TABLE IF NOT EXISTS objective_assessments (
  user_id      text    NOT NULL,
  id           text    NOT NULL,
  objective_id text    NOT NULL,
  domain       text    NOT NULL,
  dimension    text    NOT NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 0 AND 4),
  evidence     text    NOT NULL,
  hints        integer NOT NULL DEFAULT 0,
  independent  boolean NOT NULL DEFAULT true,
  source       text,
  assessed_at  bigint  NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS objective_assessments_obj
  ON objective_assessments (user_id, objective_id, assessed_at);

ALTER TABLE learning_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE objective_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE objective_assessments ENABLE ROW LEVEL SECURITY;
