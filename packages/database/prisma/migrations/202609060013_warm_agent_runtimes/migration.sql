CREATE TABLE agent_runtimes (
 id text PRIMARY KEY, org_id text NOT NULL, thread_id text NOT NULL, project_id text NOT NULL,
 actor_id text NOT NULL REFERENCES users(id), connection_id text NOT NULL REFERENCES provider_connections(id),
 owner text NOT NULL, state text NOT NULL CHECK (state IN ('active','idle','stopping','stopped')),
 heartbeat_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, idle_until timestamptz,
 stopped_at timestamptz, stop_proof text,
 FOREIGN KEY (org_id,project_id) REFERENCES projects(org_id,id),
 FOREIGN KEY (thread_id,project_id) REFERENCES conversation_threads(id,project_id),
 CHECK ((state='stopped')=(stopped_at IS NOT NULL)),
 CHECK (stopped_at IS NULL OR stop_proof IS NOT NULL)
);
CREATE UNIQUE INDEX agent_runtime_live_thread ON agent_runtimes(thread_id) WHERE stopped_at IS NULL;
CREATE INDEX agent_runtimes_project_state ON agent_runtimes(project_id,state);
ALTER TABLE agent_turns ADD COLUMN runtime_id text REFERENCES agent_runtimes(id);
