-- Open Media Events (Layer 1) storage on Cloudflare D1.
-- Canonical events are shared, provider-neutral records. Everything a person
-- does with them (plans, registrations, feedback, preferences) is keyed by
-- user_id so the same schema serves many users.

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  date_only INTEGER NOT NULL DEFAULT 0,
  timezone TEXT,
  status TEXT NOT NULL,
  attendance_mode TEXT NOT NULL,
  city TEXT,
  latitude REAL,
  longitude REAL,
  record_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_starts_idx ON events (starts_at);

CREATE TABLE IF NOT EXISTS event_sources (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS event_sources_event_idx ON event_sources (event_id);

CREATE TABLE IF NOT EXISTS event_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_changes_event_idx ON event_changes (event_id, detected_at);

CREATE TABLE IF NOT EXISTS provider_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY,
  last_ok_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  explicit_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learned_signals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal TEXT NOT NULL,
  observations INTEGER NOT NULL DEFAULT 0,
  positive INTEGER NOT NULL DEFAULT 0,
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, signal)
);

CREATE TABLE IF NOT EXISTS event_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  state TEXT NOT NULL,
  notes TEXT,
  hold_start TEXT,
  hold_end TEXT,
  travel_before_minutes INTEGER NOT NULL DEFAULT 0,
  travel_after_minutes INTEGER NOT NULL DEFAULT 0,
  calendar_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS event_plans_user_idx ON event_plans (user_id, state);

CREATE TABLE IF NOT EXISTS plan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES event_plans(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  status TEXT NOT NULL,
  method TEXT NOT NULL,
  verification TEXT NOT NULL,
  provider TEXT,
  provider_reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS registrations_user_idx ON registrations (user_id, event_id);

CREATE TABLE IF NOT EXISTS event_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_interactions_user_idx ON event_interactions (user_id, kind, at);

CREATE TABLE IF NOT EXISTS event_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  rating INTEGER,
  attended INTEGER,
  would_return INTEGER,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  last_status TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, url)
);

CREATE TABLE IF NOT EXISTS calendar_feed_versions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT,
  outcome TEXT NOT NULL,
  detail_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_action_log_user_idx ON agent_action_log (user_id, at);
