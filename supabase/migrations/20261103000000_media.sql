-- Pictures live in Cloudflare R2; this table records who owns which one, so reads are checked
-- against the signed-in user and every account has a storage quota. The object key is
-- u/<user_id>/<sha256>, so identical pictures of one user are stored once.
CREATE TABLE IF NOT EXISTS media_objects (
  user_id    text    NOT NULL,
  sha256     text    NOT NULL,
  size       integer NOT NULL,
  type       text    NOT NULL,
  confirmed  boolean NOT NULL DEFAULT false,
  created_at bigint  NOT NULL,
  PRIMARY KEY (user_id, sha256)
);

-- Same as the other tables: deny the public REST API; our server connects as the owner.
ALTER TABLE media_objects ENABLE ROW LEVEL SECURITY;
