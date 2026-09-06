CREATE TABLE execution_runtime (project_id text PRIMARY KEY REFERENCES projects(id), expires_at timestamptz NOT NULL);
