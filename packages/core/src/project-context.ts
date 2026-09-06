import { json, type DB } from '@r2cloud/database';
import { lockRow } from '@r2cloud/database/locking';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
export async function access(
  db: DB,
  actor: Pick<Actor, 'id'>,
  projectId: string,
  capability?: 'contribute' | 'review' | 'merge',
) {
  const grant = await db.project_access.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: actor.id } },
    include: { projects: true, memberships: { include: { users: true } } },
  });
  requireThat(grant, 403, 'You do not have access to this project.');
  if (capability)
    requireThat(grant[capability], 403, `This action requires project ${capability} permission.`);
  if (capability === 'review' || capability === 'merge')
    requireThat(
      grant.memberships.users.kind === 'human',
      403,
      'A person must authorise this action.',
    );
  return {
    ...grant.projects,
    contribute: grant.contribute,
    review: grant.review,
    merge: grant.merge,
    actor_kind: grant.memberships.users.kind,
  };
}
export type AccessibleProject = Awaited<ReturnType<typeof access>>;
export async function lockProject(db: DB, projectId: string) {
  const project = await db.projects.findUnique({
    where: { id: projectId },
    select: { org_id: true },
  });
  requireThat(project, 404, 'Project not found.');
  // Fixed order coordinates events and organisation/repository limits across processes.
  await lockRow(db, 'organisations', project.org_id);
  await lockRow(db, 'projects', projectId);
}
export async function event(
  db: DB,
  projectId: string,
  taskId: string | null,
  actorId: string | null,
  kind: string,
  detail: unknown = {},
) {
  const project = await db.projects.findUniqueOrThrow({
    where: { id: projectId },
    select: { org_id: true },
  });
  await db.events.create({
    data: {
      org_id: project.org_id,
      project_id: projectId,
      task_id: taskId,
      actor_id: actorId,
      kind,
      detail: json(detail),
    },
  });
}
