ALTER TABLE tasks ADD COLUMN assignee_id text REFERENCES users(id),
  ADD COLUMN board_status text NOT NULL DEFAULT 'todo' CHECK (board_status IN ('todo', 'ongoing', 'completed')),
  ADD COLUMN work_started_at timestamptz;
UPDATE tasks SET board_status = CASE WHEN state = 'completed' THEN 'completed' WHEN state IN ('todo','cancelled') THEN 'todo' ELSE 'ongoing' END;
UPDATE tasks SET assignee_id = c.owner_id, work_started_at = CASE WHEN tasks.board_status = 'ongoing' THEN c.created_at END
FROM (SELECT DISTINCT ON (task_id) task_id, owner_id, created_at FROM claims ORDER BY task_id, created_at DESC, id DESC) c
WHERE tasks.id = c.task_id;
ALTER TABLE tasks ADD CONSTRAINT tasks_board_completed CHECK (board_status <> 'completed' OR state = 'completed');
CREATE INDEX tasks_project_assignee_board ON tasks(project_id, assignee_id, board_status);
