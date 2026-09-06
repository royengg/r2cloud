import { prisma, type DB } from '@r2cloud/database';
import type { AgentGrant } from '@r2cloud/contracts/agent';
import type { AgentSession, SessionControl } from '@r2cloud/adapters/agent-session';
import { requireThat } from '@r2cloud/contracts/domain';
import { access, lockProject } from './project-context';

export async function reserveAgentRuntime(db: DB, grant: AgentGrant, owner: string) {
  const existing = await db.agentRuntime.findFirst({
    where: { threadId: grant.threadId, stoppedAt: null },
  });
  if (existing) {
    if (existing.owner !== owner || existing.state !== 'idle') return null;
    if (
      existing.actorId !== grant.actorId ||
      existing.connectionId !== grant.connectionId ||
      (existing.idleUntil?.getTime() ?? 0) <= Date.now() ||
      existing.expiresAt.getTime() < Date.now() + 60000
    ) {
      await db.agentRuntime.update({ where: { id: existing.id }, data: { state: 'stopping' } });
      return null;
    }
    return db.agentRuntime.update({
      where: { id: existing.id },
      data: { state: 'active', idleUntil: null, heartbeatAt: new Date() },
    });
  }
  return db.agentRuntime.create({
    data: {
      id: grant.id,
      orgId: grant.orgId,
      threadId: grant.threadId,
      projectId: grant.projectId,
      actorId: grant.actorId,
      connectionId: grant.connectionId,
      owner,
      state: 'active',
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
}
export async function authorizeAgentRuntime(grant: AgentGrant, owner: string) {
  if (!grant.runtimeId) return;
  const runtime = await prisma.agentRuntime.findFirst({
    where: {
      id: grant.runtimeId,
      projectId: grant.projectId,
      threadId: grant.threadId,
      actorId: grant.actorId,
      connectionId: grant.connectionId,
      owner,
      stoppedAt: null,
      state: { in: ['active', 'idle'] },
    },
  });
  requireThat(
    runtime && runtime.expiresAt.getTime() > Date.now(),
    409,
    'The sandbox session lease has ended.',
  );
  await access(prisma, { id: grant.actorId }, grant.projectId, 'contribute');
  await prisma.agentRuntime.updateMany({
    where: { id: runtime.id, owner, stoppedAt: null },
    data: { heartbeatAt: new Date() },
  });
}
export async function maintainAgentRuntimes(
  backend: AgentSession,
  control: SessionControl,
  projectId: string,
  owner: string,
) {
  const runtimes = await prisma.agentRuntime.findMany({ where: { projectId, stoppedAt: null } });
  for (const runtime of runtimes) {
    const stale = runtime.heartbeatAt.getTime() < Date.now() - 90000;
    if (runtime.owner !== owner && !stale) continue;
    const orphan =
      runtime.state === 'active' &&
      !(await prisma.agentTurn.count({ where: { runtimeId: runtime.id, stoppedAt: null } }));
    if (runtime.owner === owner && runtime.state === 'active' && !orphan) continue;
    const turn = await prisma.agentTurn.findFirst({
      where: { runtimeId: runtime.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!turn) continue;
    const grant = {
      ...(turn.grant as unknown as AgentGrant),
      runtimeId: runtime.id,
      runtimeExpiresAt: runtime.expiresAt.getTime(),
    };
    const thread = await prisma.conversationThread.findUniqueOrThrow({
      where: { id: runtime.threadId },
    });
    let retire =
      orphan ||
      stale ||
      runtime.state === 'stopping' ||
      !!thread.archivedAt ||
      runtime.expiresAt.getTime() < Date.now() + 15000 ||
      (runtime.idleUntil?.getTime() ?? Infinity) < Date.now();
    if (!retire) {
      try {
        await control.authorizeRuntime!(grant);
      } catch {
        retire = true;
      }
    }
    if (!retire) continue;
    const claimed = await prisma.$transaction(async (db) => {
      await lockProject(db, projectId);
      const current = await db.agentRuntime.findUniqueOrThrow({ where: { id: runtime.id } });
      if (
        current.stoppedAt ||
        (current.owner !== owner && current.heartbeatAt.getTime() >= Date.now() - 90000) ||
        (current.owner === owner &&
          current.state === 'active' &&
          (await db.agentTurn.count({ where: { runtimeId: current.id, stoppedAt: null } })))
      )
        return false;
      await db.agentRuntime.update({
        where: { id: current.id },
        data: { owner, state: 'stopping', heartbeatAt: new Date() },
      });
      await db.agentTurn.updateMany({
        where: { runtimeId: current.id, stoppedAt: null },
        data: { state: 'unknown' },
      });
      return true;
    });
    if (!claimed) continue;
    const proof = await backend.retire(grant);
    if (!turn.stoppedAt)
      await control.finish(
        grant,
        proof,
        'The previous runtime disconnected and was stopped before recovery.',
      );
  }
}

export async function agentResourceUsage(
  db: DB,
  orgId: string,
  runtimeId?: string,
  turnId?: string,
) {
  const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT (
 (SELECT count(*) FROM agent_runtimes WHERE org_id=${orgId} AND stopped_at IS NULL AND id IS DISTINCT FROM ${runtimeId ?? null}) +
 (SELECT count(*) FROM agent_turns WHERE org_id=${orgId} AND stopped_at IS NULL AND runtime_id IS NULL AND id IS DISTINCT FROM ${turnId ?? null}) +
 (SELECT count(*) FROM runs WHERE org_id=${orgId} AND stopped_at IS NULL AND manifest->>'agentTurnId' IS NULL)
 ) AS count`;
  return Number(rows[0]!.count);
}
