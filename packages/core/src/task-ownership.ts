import type { DB, tasks } from '@r2cloud/database';
import { requireThat, type Actor, type Command } from '@r2cloud/contracts/domain';
import { event, type AccessibleProject } from './project-context';

export function managesTasks(project: AccessibleProject) {
  return ['owner', 'admin'].includes(project.workspace_role);
}

export function requireTaskAssignee(task: tasks, actorId: string) {
  requireThat(
    task.assignee_id === actorId,
    403,
    'Assign this task to yourself before starting work.',
  );
}

export function requireTaskPublication(project: AccessibleProject, task: tasks, actorId: string) {
  requireThat(project.actor_kind === 'human', 403, 'A person must authorise publication.');
  requireThat(
    project.review || (project.contribute && task.assignee_id === actorId),
    403,
    'Publication requires review permission or contribution permission on a task assigned to you.',
  );
}

async function requireStopped(db: DB, taskId: string) {
  requireThat(
    !(await db.runs.count({ where: { task_id: taskId, stopped_at: null } })),
    409,
    'Stop the agent before moving or reassigning this task.',
  );
  requireThat(
    !(await db.agentTurn.count({ where: { thread: { taskId }, stoppedAt: null } })),
    409,
    'Wait for the active conversation or stop it before changing ownership.',
  );
  requireThat(
    !(await db.jobs.count({
      where: {
        task_id: taskId,
        OR: [
          { state: { in: ['ready', 'processing', 'uncertain'] } },
          { kind: { in: ['publish', 'merge'] }, state: { not: 'done' } },
        ],
      },
    })),
    409,
    'Resolve pending operations before moving or reassigning this task.',
  );
}

export async function changeTaskOwnership(
  db: DB,
  actor: Actor,
  project: AccessibleProject,
  task: tasks,
  input: Extract<Command, { action: 'assign' | 'move' }>,
) {
  requireThat(project.actor_kind === 'human', 403, 'A person must change task ownership.');
  await requireStopped(db, task.id);
  requireThat(
    !['publishing', 'code_review', 'merging', 'completed'].includes(task.state),
    409,
    'Finish or resolve code review before changing this task.',
  );
  if (input.action === 'assign') {
    requireThat(
      managesTasks(project) ||
        (task.assignee_id === null &&
          task.board_status === 'todo' &&
          input.assigneeId === actor.id),
      403,
      'Only a workspace owner or admin can reassign tasks.',
    );
    requireThat(
      input.assigneeId !== null || task.board_status === 'todo',
      409,
      'Move this task to Todo before removing its assignee.',
    );
    if (input.assigneeId)
      requireThat(
        await db.project_access.count({
          where: {
            project_id: task.project_id,
            user_id: input.assigneeId,
            contribute: true,
            memberships: { users: { kind: 'human' } },
          },
        }),
        403,
        'Choose a contributor with access to this project.',
      );
    await db.tasks.update({
      where: { id: task.id },
      data: { assignee_id: input.assigneeId, version: { increment: 1 } },
    });
    if (input.assigneeId)
      await db.claims.updateMany({
        where: { task_id: task.id, released_at: null },
        data: { owner_id: input.assigneeId },
      });
    await db.approvals.updateMany({
      where: { task_id: task.id, consumed_at: null },
      data: { revoked_at: new Date() },
    });
    await event(db, task.project_id, task.id, actor.id, 'Task assigned', {
      previousAssigneeId: task.assignee_id,
      assigneeId: input.assigneeId,
    });
  } else {
    requireThat(task.assignee_id !== null, 409, 'Assign this task before moving it to Ongoing.');
    requireThat(
      task.assignee_id === actor.id || managesTasks(project),
      403,
      'Only the assignee or a workspace owner or admin can move this task.',
    );
    requireThat(task.board_status !== input.status, 409, 'This task is already in that column.');
    await db.tasks.update({
      where: { id: task.id },
      data: {
        board_status: input.status,
        work_started_at: input.status === 'ongoing' ? new Date() : null,
        version: { increment: 1 },
      },
    });
    await event(db, task.project_id, task.id, actor.id, 'Task moved', {
      from: task.board_status,
      to: input.status,
      assigneeId: task.assignee_id,
    });
  }
  return { id: task.id };
}
