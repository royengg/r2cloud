ALTER TABLE conversation_threads ADD COLUMN provider_id text, ADD COLUMN provider_state text;
CREATE TABLE agent_turns (
 id text PRIMARY KEY, org_id text NOT NULL, project_id text NOT NULL,
 thread_id text NOT NULL, actor_id text NOT NULL REFERENCES users(id), "grant" jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','waiting','unknown','finished','failed')),
 stop_requested boolean NOT NULL DEFAULT false, heartbeat_at timestamptz, stopped_at timestamptz,
 last_sequence integer NOT NULL DEFAULT 0, error text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (thread_id, project_id) REFERENCES conversation_threads(id, project_id),
 FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id,id),
 CHECK ((state IN ('finished','failed')) = (stopped_at IS NOT NULL))
);
CREATE UNIQUE INDEX agent_turns_active ON agent_turns(thread_id) WHERE stopped_at IS NULL;
CREATE INDEX agent_turns_project_state ON agent_turns(project_id,state,created_at);
CREATE TABLE agent_items (
 id text PRIMARY KEY, turn_id text NOT NULL REFERENCES agent_turns(id), source_id text NOT NULL,
 kind text NOT NULL, text text NOT NULL DEFAULT '', status text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
 revision bigserial NOT NULL, UNIQUE (turn_id,source_id)
);
CREATE TABLE agent_requests (
 id text PRIMARY KEY, turn_id text NOT NULL REFERENCES agent_turns(id), source_id text NOT NULL,
 kind text NOT NULL, prompt text NOT NULL, detail jsonb NOT NULL, response jsonb,
 resolved_by text REFERENCES users(id), UNIQUE (turn_id,source_id)
);
ALTER TABLE sandbox_allocations ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE sandbox_allocations ADD COLUMN agent_turn_id text UNIQUE REFERENCES agent_turns(id);
ALTER TABLE sandbox_allocations ADD CONSTRAINT sandbox_execution_identity CHECK (num_nonnulls(run_id, agent_turn_id) = 1);
