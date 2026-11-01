-- Agent skills. owner = '' is the shared default set (edited by an admin, served publicly);
-- any other owner is a user id and that user's private skills, which override a default of the
-- same name for them. Every overwrite or delete keeps the previous text in skill_history.
CREATE TABLE IF NOT EXISTS skill_files (
  owner      text   NOT NULL DEFAULT '',
  skill      text   NOT NULL,
  path       text   NOT NULL,
  content    text   NOT NULL,
  updated_at bigint NOT NULL,
  updated_by text,
  PRIMARY KEY (owner, skill, path)
);

CREATE TABLE IF NOT EXISTS skill_history (
  id       bigserial PRIMARY KEY,
  owner    text   NOT NULL DEFAULT '',
  skill    text   NOT NULL,
  path     text   NOT NULL,
  content  text   NOT NULL,
  saved_at bigint NOT NULL,
  saved_by text
);
CREATE INDEX IF NOT EXISTS skill_history_file ON skill_history (owner, skill, path, id DESC);

-- Same as the other tables: deny the public REST API; our server connects as the owner.
ALTER TABLE skill_files   ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_history ENABLE ROW LEVEL SECURITY;
