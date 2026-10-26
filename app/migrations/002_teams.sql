CREATE TABLE teams (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members (user_id);

ALTER TABLE documents ADD COLUMN team_id TEXT REFERENCES teams (id);
CREATE INDEX documents_team ON documents (team_id);
