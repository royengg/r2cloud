import { prisma, json } from '@r2cloud/database';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import type { AgentGrant } from '@r2cloud/contracts/agent';
import type { RunGrant, RunResult } from '@r2cloud/contracts/adapters';
import { commandInTransaction } from './service';
import { access, event, lockProject } from './project-context';
import { waitForAgentResponse } from './agent-tools';
import { digest, id } from '@r2cloud/contracts/hash';

export async function claimAgentTask(
  grant: AgentGrant,
  callId: string,
  input: { taskId: string; version: number; summary: string },
): Promise<RunGrant> {
  requireThat(
    !grant.taskId || input.taskId === grant.taskId,
    403,
    'This thread is attached to another task.',
  );
  const task = await prisma.tasks.findFirst({
    where: { id: input.taskId, project_id: grant.projectId },
  });
  requireThat(task, 404, 'Task not found in this project.');
  const response = await waitForAgentResponse(
    grant,
    callId,
    'approval',
    `Start work: ${task.title}`,
    { taskId: task.id, version: input.version, summary: input.summary },
  );
  requireThat(response.approved, 403, 'Implementation was not approved.');
  return prisma.$transaction(async (db) => {
    await lockProject(db, grant.projectId);
    const actor = { id: grant.actorId } as Actor;
    await access(db, actor, grant.projectId, 'contribute');
    const turn = await db.agentTurn.findUniqueOrThrow({ where: { id: grant.id } });
    requireThat(
      !turn.stoppedAt && !turn.stopRequested,
      409,
      'This turn is no longer accepting work.',
    );
    const existing = await db.runs.findFirst({
      where: { project_id: grant.projectId, manifest: { path: ['agentTurnId'], equals: grant.id } },
    });
    requireThat(!existing, 409, 'This turn already owns an implementation.');
    const current = await db.tasks.findUniqueOrThrow({ where: { id: task.id } });
    const thread = await db.conversationThread.findUniqueOrThrow({ where: { id: grant.threadId } });
    requireThat(!thread.taskId || thread.taskId === task.id, 409, 'Thread task changed.');
    if (current.state !== 'todo')
      requireThat(
        await db.claims.count({
          where: { task_id: task.id, owner_id: grant.actorId, released_at: null },
        }),
        403,
        'Only the implementation owner can continue this task.',
      );
    await db.conversationThread.update({ where: { id: thread.id }, data: { taskId: task.id } });
    const result = await commandInTransaction(
      db,
      actor,
      grant.projectId,
      task.id,
      current.state === 'todo'
        ? {
            action: 'start',
            version: input.version,
            minutes: 10,
            budgetCents: 0,
            threadId: thread.id,
            threadVersion: thread.version,
          }
        : {
            action: 'changes',
            version: input.version,
            feedback: grant.message,
            threadId: thread.id,
            threadVersion: thread.version,
          },
      grant.id,
    );
    const run = await db.runs.findUniqueOrThrow({
      where: { id: (result as { runId: string }).runId },
    });
    await db.runs.update({
      where: { id: run.id },
      data: { state: 'running', heartbeat_at: new Date() },
    });
    return {
      operationId: grant.id,
      runId: run.id,
      taskId: task.id,
      projectId: grant.projectId,
      orgId: grant.orgId,
      generation: run.generation,
      outcome: current.outcome,
      criteria: current.criteria as string[],
      feedback: [grant.message],
      config: run.manifest as unknown as RunGrant['config'],
    };
  });
}
export async function finishAgentImplementation(
  grant: AgentGrant,
  proof: string,
  result?: Omit<RunResult, 'stopProof'>,
  error?: string,
) {
  await prisma.$transaction(async (db) => {
    await lockProject(db, grant.projectId);
    const run = await db.runs.findFirst({
      where: {
        project_id: grant.projectId,
        manifest: { path: ['agentTurnId'], equals: grant.id },
        stopped_at: null,
      },
    });
    if (!run) return;
    const task = await db.tasks.findUniqueOrThrow({ where: { id: run.task_id } });
    requireThat(task.generation === run.generation, 409, 'Implementation generation changed.');
    let candidateId: string | undefined;
    if (result) {
      const m = result.manifest;
      const config = run.manifest as unknown as RunGrant['config'];
      requireThat(
        m.runId === run.id &&
          m.taskId === task.id &&
          m.projectId === grant.projectId &&
          m.orgId === grant.orgId &&
          m.generation === run.generation &&
          m.baseSha === config.baseSha &&
          m.repository === config.repository &&
          m.targetRef === config.targetRef &&
          !m.fixture &&
          result.evidence.snapshotDigest === m.artifactDigest,
        409,
        'Candidate identity does not match the execution.',
      );
      candidateId = id();
      await db.candidates.create({
        data: {
          id: candidateId,
          org_id: grant.orgId,
          project_id: grant.projectId,
          task_id: task.id,
          run_id: run.id,
          generation: run.generation,
          digest: digest(m),
          manifest: json(m),
          evidence: json(result.evidence),
        },
      });
    }
    await db.runs.update({
      where: { id: run.id },
      data: { state: 'stopped', stopped_at: new Date(), stop_proof: proof },
    });
    const state =
      !error && candidateId && result?.evidence.checks.every((c) => c.status !== 'failed')
        ? 'review'
        : 'blocked';
    await db.tasks.update({
      where: { id: task.id },
      data: { state, candidate_id: candidateId ?? null, version: { increment: 1 } },
    });
    await event(
      db,
      grant.projectId,
      task.id,
      null,
      candidateId ? 'Ready for your review' : 'Implementation stopped',
      {
        threadId: grant.threadId,
        error: error ?? (!candidateId ? 'No repository changes were produced.' : undefined),
      },
    );
  });
}
