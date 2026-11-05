-- Edit history: the version a note had before each edit, kept for 7 days. Pruned by the server on
-- every edit of the same note (the newest old version is always kept), so there is no cron job.
-- Server-only: never synced to devices. Inline pictures are not stored here.
CREATE TABLE IF NOT EXISTS note_versions (
  user_id     text   NOT NULL,
  id          text   NOT NULL,
  note_id     text   NOT NULL,
  content     jsonb  NOT NULL,
  tags        jsonb  NOT NULL DEFAULT '[]',
  sort_field  text,
  replaced_at bigint NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS note_versions_note
  ON note_versions (user_id, note_id, replaced_at DESC);

ALTER TABLE note_versions ENABLE ROW LEVEL SECURITY;
