import { lockProject } from './project-context';
import { prisma, json, type DB } from '@r2cloud/database';
import { lockRow } from '@r2cloud/database/locking';
import { requireThat } from '@r2cloud/contracts/domain';
import type { SandboxJournal, VercelIdentity } from '@r2cloud/adapters/vercel';
async function fence(db: DB, identity: VercelIdentity) {
  const agentTurn = await db.agentTurn.findUnique({ where: { id: identity.runId } });
  if (agentTurn) {
    await lockProject(db, agentTurn.projectId);
    const current = await db.agentTurn.findUniqueOrThrow({ where: { id: agentTurn.id } });
    requireThat(
      !current.stoppedAt &&
        current.state !== 'queued' &&
        identity.operationId === current.id &&
        identity.generation === 1,
      409,
      'Stale agent execution.',
    );
    return { manifest: { minutes: 10 }, agent: true };
  }
  const existing = await db.runs.findUnique({
    where: { id: identity.runId },
    select: { task_id: true },
  });
  requireThat(existing, 409, 'Stale or unauthorised sandbox execution.');
  await lockRow(db, 'tasks', existing.task_id);
  await lockRow(db, 'runs', identity.runId);
  const run = await db.runs.findFirst({
    where: {
      id: identity.runId,
      generation: identity.generation,
      stopped_at: null,
      manifest: { path: ['mode'], equals: 'managed' },
      claims: { released_at: null, tasks: { generation: identity.generation } },
    },
  });
  const job = await db.jobs.count({ where: { id: identity.operationId, run_id: identity.runId } });
  requireThat(run && job, 409, 'Stale or unauthorised sandbox execution.');
  return { manifest: run.manifest, agent: false };
}
export class PostgresSandboxJournal implements SandboxJournal {
  async reserve(identity: VercelIdentity, name: string, configHash: string, minutes: number) {
    return prisma.$transaction(async (db) => {
      const run = await fence(db, identity);
      const grant = run.manifest as { minutes: number };
      requireThat(
        Number.isFinite(grant.minutes) && minutes <= grant.minutes,
        403,
        'Sandbox duration exceeds the authorised run limit.',
      );
      const inserted = await db.sandboxAllocation.createMany({
        data: [
          {
            operationId: identity.operationId,
            generation: identity.generation,
            ...(run.agent ? { agentTurnId: identity.runId } : { runId: identity.runId }),
            name,
            configHash,
            state: 'creating',
          },
        ],
        skipDuplicates: true,
      });
      const row = await db.sandboxAllocation.findUnique({
        where: { operationId: identity.operationId },
      });
      requireThat(
        row && row.configHash === configHash,
        409,
        'Execution already has a different sandbox allocation.',
      );
      return {
        fresh: inserted.count === 1,
        allocation: { ...row, runId: row.runId ?? row.agentTurnId! },
      };
    });
  }
  async get(identity: VercelIdentity) {
    return prisma.$transaction(async (db) => {
      await fence(db, identity);
      const row = await db.sandboxAllocation.findFirst({
        where: {
          operationId: identity.operationId,
          generation: identity.generation,
          OR: [{ runId: identity.runId }, { agentTurnId: identity.runId }],
        },
      });
      return row ? { ...row, runId: row.runId ?? row.agentTurnId! } : null;
    });
  }
  async mark(identity: VercelIdentity, state: string, stopProof?: string) {
    await prisma.$transaction(async (db) => {
      await fence(db, identity);
      const row = await db.sandboxAllocation.updateMany({
        where: {
          operationId: identity.operationId,
          state: { notIn: state === 'stopped' ? ['stopped'] : ['stopped', 'stopping'] },
        },
        data: { state, ...(stopProof === undefined ? {} : { stopProof }) },
      });
      requireThat(row.count, 409, 'Sandbox lifecycle was superseded.');
    });
  }
  async beginStep(identity: VercelIdentity, key: string, payloadHash: string) {
    return prisma.$transaction(async (db) => {
      await fence(db, identity);
      // The run lock serializes allocation and step mutations for this execution.
      const allocation = await db.sandboxAllocation.findUnique({
        where: { operationId: identity.operationId },
      });
      requireThat(allocation?.state === 'running', 409, 'Sandbox is not accepting commands.');
      const inserted = await db.sandboxStep.createMany({
        data: [{ operationId: identity.operationId, key, payloadHash, state: 'pending' }],
        skipDuplicates: true,
      });
      const row = await db.sandboxStep.findUniqueOrThrow({
        where: { operationId_key: { operationId: identity.operationId, key } },
      });
      requireThat(
        row.payloadHash === payloadHash,
        409,
        'Command key was reused with different content.',
      );
      return {
        fresh: inserted.count === 1,
        ...(row.state === 'finished' ? { result: row.result } : {}),
      };
    });
  }
  async finishStep(identity: VercelIdentity, key: string, result: unknown) {
    await prisma.$transaction(async (db) => {
      await fence(db, identity);
      await db.sandboxStep.updateMany({
        where: { operationId: identity.operationId, key, state: 'pending' },
        data: { state: 'finished', result: json(result) },
      });
    });
  }
}
