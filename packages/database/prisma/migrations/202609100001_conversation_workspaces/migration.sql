CREATE TABLE conversation_workspaces (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  created_by text NOT NULL REFERENCES users(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, project_id)
);
CREATE INDEX conversation_workspaces_project_id_created_by_created_at_idx ON conversation_workspaces(project_id, created_by, created_at);
INSERT INTO conversation_workspaces (id, project_id, created_by, title, created_at)
SELECT 'default:' || project_id || ':' || created_by, project_id, created_by, 'Workspace', min(created_at)
FROM conversation_threads GROUP BY project_id, created_by;
ALTER TABLE conversation_threads ADD COLUMN workspace_id text;
UPDATE conversation_threads SET workspace_id = 'default:' || project_id || ':' || created_by;
ALTER TABLE conversation_threads ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE conversation_threads ADD FOREIGN KEY (workspace_id, project_id) REFERENCES conversation_workspaces(id, project_id);
CREATE INDEX conversation_threads_workspace_id_updated_at_idx ON conversation_threads(workspace_id, updated_at);
