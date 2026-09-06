CREATE TABLE conversation_threads (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  org_id text NOT NULL,
  task_id text,
  created_by text NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  model text,
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 8000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, project_id),
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id),
  FOREIGN KEY (org_id, project_id, task_id) REFERENCES tasks(org_id, project_id, id)
);
CREATE INDEX conversation_threads_project_updated ON conversation_threads(project_id, updated_at);
ALTER TABLE comments ADD COLUMN thread_id text;
ALTER TABLE comments ADD CONSTRAINT comments_thread_project_fk
  FOREIGN KEY (thread_id, project_id) REFERENCES conversation_threads(id, project_id);
CREATE INDEX comments_thread_created ON comments(thread_id, created_at);
ALTER TABLE codex_connections ADD COLUMN models jsonb NOT NULL DEFAULT '[]';
ALTER TABLE codex_connections ADD COLUMN models_updated_at timestamptz;
