import { type DB, type tasks } from '@r2cloud/database';
import { requireThat } from '@r2cloud/contracts/domain';
import { agentResourceUsage } from './agent-runtimes';

// Admission callers must hold the organisation lock.
export async function checkExecutionCapacity(db: DB, orgId: string, agentTurnId?: string) {
  const turn = agentTurnId
    ? await db.agentTurn.findUnique({ where: { id: agentTurnId }, select: { runtimeId: true } })
    : null;
  const active = await agentResourceUsage(db, orgId, turn?.runtimeId ?? undefined, agentTurnId);
  const org = await db.organisations.findUniqueOrThrow({ where: { id: orgId } });
  requireThat(active < org.max_runs, 409, 'The organisation has reached its concurrent run limit.');
}

export async function checkTaskStart(db: DB, task: tasks) {
  requireThat(task.state === 'todo', 409, 'This task already has an implementation owner.');
  const dependencies = await db.dependencies.count({
    where: {
      task_id: task.id,
      tasks_dependencies_org_id_project_id_depends_onTotasks: { state: { not: 'completed' } },
    },
  });
  requireThat(!dependencies, 409, 'Complete the prerequisite tasks before starting this work.');
}
