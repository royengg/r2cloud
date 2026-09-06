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
  run: {
    state: string;
    manifest: { mode?: string; skills: { id: string; version: string }[] };
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
  todo: 'Ready to start',
  building: 'Building',
  review: 'Needs your review',
  publishing: 'Publishing for code review',
  code_review: 'In code review',
  merging: 'Verifying merge',
  completed: 'Merged and verified',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};
export const columnFor = (task: Task) =>
  task.state === 'todo' ? 'todo' : task.state === 'completed' ? 'completed' : 'ongoing';
