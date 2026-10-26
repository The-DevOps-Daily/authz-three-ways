CREATE TABLE users (
  id   TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin'))
);

CREATE TABLE documents (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL
);
