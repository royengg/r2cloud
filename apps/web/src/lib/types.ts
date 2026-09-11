import type { CandidateManifest, Evidence } from '@r2cloud/contracts/domain';
export type Person = { id: string; name: string; review?: boolean };
export type Project = {
  repo_id?: string | null;
  provider_connected?: boolean;
  id: string;
  name: string;
  org_name?: string;
  workspace_role?: string;
  org_id: string;
  contribute?: boolean;
  review?: boolean;
  merge?: boolean;
};
export type Task = {
  assignee_id: string | null;
  assignee_name: string | null;
  board_status: 'todo' | 'ongoing' | 'completed';
  work_started_at: string | null;
  id: string;
  title: string;
  outcome: string;
  criteria: string[];
  priority: 'High' | 'Medium' | 'Low';
  state: string;
  version: number;
  generation: number;
  owner_name: string | null;
  owner_id: string | null;
  agent?: { state: string; threadTitle: string; model: string | null; count: number } | null;
  run: {
    state: string;
    stopped_at?: string | null;
    thread_title?: string | null;
    manifest: {
      mode?: string;
      thread?: { id: string; model: string | null };
      skills: { id: string; version: string }[];
    };
  } | null;
  candidate: { id: string; digest: string; manifest: CandidateManifest; evidence: Evidence } | null;
  publication: { pr_number: number; url: string } | null;
  completed_at: string | null;
};
export type Comment = {
  threadId?: string | null;
  id: string;
  task_id: string | null;
  body: string;
  name: string;
  created_at: string;
};
export type Activity = {
  id: string;
  task_id: string | null;
  kind: string;
  created_at: string;
  detail: { message?: string };
};
export type Snapshot = {
  project: Project;
  tasks: Task[];
  participants: Person[];
  comments: Comment[];
  events: Activity[];
  cursor: string;
};
export type Invitation = {
  id: string;
  project_name: string;
  workspace_name: string;
  inviter_name: string;
  contribute: boolean;
  review: boolean;
  merge: boolean;
  expires_at: string;
};
export type Identity = {
  invitations?: Invitation[];
  authMode?: string;
  user: Person;
  projects: Project[];
  mode: string;
};
export const statuses: Record<string, string> = {
  todo: 'Todo',
  building: 'In progress',
  review: 'In review',
  publishing: 'Publishing',
  code_review: 'In code review',
  merging: 'Merging',
  completed: 'Completed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};
export const columnFor = (task: Task) => task.board_status;

export type ConversationWorkspace = {
  id: string;
  projectId: string;
  createdBy: string;
  title: string;
};

export type Thread = {
  workspaceId: string;
  id: string;
  title: string;
  model: string | null;
  instructions: string;
  taskId: string | null;
  version: number;
  createdBy: string;
  turns?: { state: string }[];
};

export function canMoveTask(task: Task, userId: string, manager: boolean) {
  return (
    !!task.assignee_id &&
    (task.assignee_id === userId || manager) &&
    !task.agent &&
    !(task.run && !task.run.stopped_at) &&
    !['publishing', 'code_review', 'merging', 'completed'].includes(task.state)
  );
}
