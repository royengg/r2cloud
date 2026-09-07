CREATE TABLE live_previews (
  id TEXT PRIMARY KEY,
  runtime_id TEXT NOT NULL UNIQUE REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  port INTEGER NOT NULL CHECK (port BETWEEN 1024 AND 65535),
  state TEXT NOT NULL CHECK (state IN ('starting', 'ready', 'failed', 'stopped')),
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE live_preview_grants (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL REFERENCES live_previews(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  ticket_hash TEXT NOT NULL UNIQUE,
  token_hash TEXT UNIQUE,
  ticket_expires_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX live_preview_grants_expiry ON live_preview_grants(expires_at);
