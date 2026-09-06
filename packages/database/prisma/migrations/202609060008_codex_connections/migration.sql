CREATE TABLE codex_connections (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK (state IN ('queued','starting','awaiting','connected','cancelled','failed','disconnected')),
  login_id text,
  user_code text,
  plan text,
  error text,
  lease_token text,
  lease_until timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,project_id) REFERENCES projects(org_id,id)
);
CREATE UNIQUE INDEX one_codex_connection_per_project ON codex_connections(user_id,project_id)
  WHERE state IN ('queued','starting','awaiting','connected');
CREATE UNIQUE INDEX one_codex_login_per_person ON codex_connections(user_id)
  WHERE state IN ('queued','starting','awaiting');
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_mode_check;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_mode_check CHECK(mode IN ('fixture','byok-proposed','managed'));
