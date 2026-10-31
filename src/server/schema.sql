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
