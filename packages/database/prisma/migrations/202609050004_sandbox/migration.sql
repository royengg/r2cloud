CREATE TABLE sandbox_allocations (
 operation_id text PRIMARY KEY,
 run_id text NOT NULL UNIQUE REFERENCES runs(id),
 generation integer NOT NULL,
 name text NOT NULL UNIQUE,
 config_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('creating','running','stopping','stopped','uncertain')),
 stop_proof text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sandbox_steps (
 operation_id text NOT NULL REFERENCES sandbox_allocations(operation_id),
 key text NOT NULL,
 payload_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','finished')),
 result jsonb,
 PRIMARY KEY(operation_id,key)
);
