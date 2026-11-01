-- Automatic translation (ADR 0022): translations of public text only (posts, comments, event
-- descriptions), keyed by a SHA-256 of the engine version, both languages and the text. Messages,
-- bridged chats and email are never stored here. Rows older than 90 days are not reused.
CREATE TABLE IF NOT EXISTS translations (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS translations_created_at ON translations (created_at);
