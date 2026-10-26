CREATE TABLE shares (
  document_id TEXT NOT NULL REFERENCES documents (id),
  user_id     TEXT NOT NULL REFERENCES users (id),
  level       TEXT NOT NULL CHECK (level IN ('view', 'edit')),
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX shares_user ON shares (user_id);
