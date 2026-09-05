CREATE TABLE repository_connections (
 id text PRIMARY KEY,
 org_id text NOT NULL,
 project_id text NOT NULL,
 actor_id text NOT NULL REFERENCES users(id),
 state_hash text NOT NULL UNIQUE,
 verifier text,
 code text,
 status text NOT NULL CHECK(status IN ('authorizing','queued','checking','ready','failed','attached')),
 repositories jsonb,
 error text,
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '10 minutes'),
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,project_id) REFERENCES projects(org_id,id)
);
ALTER TABLE repositories ADD COLUMN github_id bigint;
ALTER TABLE repositories ADD COLUMN installation_id bigint;
CREATE UNIQUE INDEX repositories_github_identity ON repositories(org_id,github_id) WHERE github_id IS NOT NULL;
