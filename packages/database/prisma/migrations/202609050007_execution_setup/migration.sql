CREATE TABLE execution_profiles (
 project_id text PRIMARY KEY,
 org_id text NOT NULL,
 version integer NOT NULL CHECK (version > 0),
 config jsonb NOT NULL,
 updated_by text NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (org_id,project_id) REFERENCES projects(org_id,id)
);
