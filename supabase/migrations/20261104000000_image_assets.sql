-- Pictures an AI agent uploads over MCP before it makes image-occlusion cards. The agent gets a
-- stable id (asset_<first 32 hex of sha256>) and can reuse it for any number of cards. Cards copy
-- the picture into R2 (or into the note) when they are made, so deleting an asset never breaks one.
CREATE TABLE IF NOT EXISTS mcp_image_assets (
  user_id    text    NOT NULL,
  id         text    NOT NULL,
  mime       text    NOT NULL,
  size       integer NOT NULL,
  width      integer NOT NULL,
  height     integer NOT NULL,
  data       bytea   NOT NULL,
  created_at bigint  NOT NULL,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE mcp_image_assets ENABLE ROW LEVEL SECURITY;
