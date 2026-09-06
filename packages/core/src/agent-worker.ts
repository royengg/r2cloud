import { prisma, json } from '@r2cloud/database';
import type { AgentGrant } from '@r2cloud/contracts/agent';
import type { RunResult } from '@r2cloud/contracts/adapters';
import { requireThat, type CandidateManifest } from '@r2cloud/contracts/domain';
import { AgentSession, type SessionControl } from '@r2cloud/adapters/agent-session';
import { TaskCheckout } from '@r2cloud/adapters/task-checkout';
import type { CredentialVault } from '@r2cloud/adapters/credential-vault';
import { activeAgentTurn } from './agent-turns';
import { recordAgentEvents } from './agent-events';
import { callAgentTool, waitForAgentResponse } from './agent-tools';
import { claimAgentTask, finishAgentImplementation } from './agent-implementation';
import { codexCredentials } from './managed-execution';
import { event, lockProject } from './project-context';

export function agentControl(projectId: string, vault: CredentialVault): SessionControl {
  const checkouts = new Map<string, TaskCheckout>();
  const candidates = new Map<string, Omit<RunResult, 'stopProof'>>();
  const authorize = async (grant: AgentGrant) => {
    requireThat(grant.projectId === projectId, 403, 'This worker is scoped to another project.');
    await activeAgentTurn(grant);
    await prisma.agentTurn.update({ where: { id: grant.id }, data: { heartbeatAt: new Date() } });
    return codexCredentials(projectId, grant.actorId, grant.connectionId, vault);
  };
  return {
    authorize,
    async stopped(grant) {
      return (await activeAgentTurn(grant)).stopRequested;
    },
    events: recordAgentEvents,
    async request(grant, message, sandbox) {
      await authorize(grant);
      const p = message.params ?? {};
      if (message.method === 'item/tool/call') {
        const result = await callAgentTool(grant, String(message.id), p.tool, p.arguments);
        if (p.tool === 'start_task') {
          const run = await claimAgentTask(
            grant,
            String(message.id),
            (result as { implementation: { taskId: string; version: number; summary: string } })
              .implementation,
          );
          let previous: { digest: string; headSha: string } | undefined;
          if (run.config.previousCandidate) {
            const row = await prisma.candidates.findFirst({
              where: {
                id: run.config.previousCandidate,
                project_id: grant.projectId,
                task_id: run.taskId,
              },
            });
            requireThat(row, 409, 'Previous candidate is unavailable.');
            const m = row.manifest as unknown as CandidateManifest;
            requireThat(
              /^[a-f0-9]{64}$/.test(m.artifactDigest) &&
                /^[a-f0-9]{40}$/.test(m.headSha) &&
                m.baseSha === run.config.baseSha,
              409,
              'Previous candidate is invalid.',
            );
            previous = { digest: m.artifactDigest, headSha: m.headSha };
          }
          const turn = await prisma.agentTurn.findUniqueOrThrow({ where: { id: grant.id } });
          const checkout = new TaskCheckout(
            sandbox,
            run,
            await authorize(grant),
            turn.createdAt.getTime() + grant.minutes * 60000,
            previous,
          );
          const prepared = await checkout.prepare();
          checkouts.set(grant.id, checkout);
          return {
            success: true,
            contentItems: [{ type: 'inputText', text: JSON.stringify(prepared) }],
          };
        }
        return {
          success: true,
          contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
        };
      }
      if (message.method === 'item/tool/requestUserInput') {
        const response = await waitForAgentResponse(
          grant,
          String(message.id),
          'question',
          'Codex has a question',
          { questions: p.questions },
        );
        return {
          answers: Object.fromEntries(
            Object.entries(response.answers ?? {}).map(([key, answers]) => [key, { answers }]),
          ),
        };
      }
      return { decision: 'decline' };
    },
    async settle(grant, _sandbox, summary, interrupted) {
      if (candidates.has(grant.id)) return;
      await authorize(grant);
      const candidate = await checkouts.get(grant.id)?.candidate(summary, interrupted);
      if (candidate) {
        candidates.set(grant.id, candidate);
        await prisma.agentItem.upsert({
          where: { turnId_sourceId: { turnId: grant.id, sourceId: 'candidate' } },
          create: {
            id: `candidate:${grant.id}`,
            turnId: grant.id,
            sourceId: 'candidate',
            kind: 'evidence',
            text: 'Changes prepared for review',
            status: 'completed',
            detail: json(candidate),
          },
          update: {},
        });
      }
    },
    async persist(grant, providerId, state) {
      await authorize(grant);
      requireThat(state.length <= 4 * 1024 * 1024, 400, 'Session state exceeds its limit.');
      await prisma.$transaction(async (db) => {
        await lockProject(db, projectId);
        requireThat(
          await db.agentTurn.count({
            where: { id: grant.id, stoppedAt: null, state: { in: ['running', 'waiting'] } },
          }),
          409,
          'The agent session is no longer active.',
        );
        await db.conversationThread.update({
          where: { id: grant.threadId },
          data: { providerId, providerState: state },
        });
        await db.agentItem.upsert({
          where: { turnId_sourceId: { turnId: grant.id, sourceId: 'checkpoint' } },
          create: {
            id: `checkpoint:${grant.id}`,
            turnId: grant.id,
            sourceId: 'checkpoint',
            kind: 'checkpoint',
            text: '',
            status: 'completed',
          },
          update: {},
        });
      });
    },
    async finish(grant, stopProof, error) {
      requireThat(grant.projectId === projectId, 403, 'This worker is scoped to another project.');
      const recorded = await prisma.agentItem.findUnique({
        where: { turnId_sourceId: { turnId: grant.id, sourceId: 'candidate' } },
      });
      const candidate =
        candidates.get(grant.id) ??
        (recorded?.detail as unknown as Omit<RunResult, 'stopProof'> | undefined);
      await finishAgentImplementation(grant, stopProof, candidate, error);
      await prisma.$transaction(async (db) => {
        await lockProject(db, projectId);
        await db.agentTurn.updateMany({
          where: { id: grant.id, stoppedAt: null },
          data: {
            state: error ? 'failed' : 'finished',
            error: error ?? null,
            stoppedAt: new Date(),
          },
        });
        await db.agentItem.updateMany({
          where: { turnId: grant.id, status: 'running' },
          data: { status: error ? 'interrupted' : 'completed' },
        });
        if (error)
          await db.agentItem.upsert({
            where: { turnId_sourceId: { turnId: grant.id, sourceId: 'error' } },
            create: {
              id: `error:${grant.id}`,
              turnId: grant.id,
              sourceId: 'error',
              kind: 'error',
              text: error,
              status: 'completed',
            },
            update: {},
          });
        await event(
          db,
          projectId,
          grant.taskId,
          null,
          error ? 'Agent turn stopped' : 'Agent turn finished',
          { threadId: grant.threadId },
        );
      });
      checkouts.delete(grant.id);
      candidates.delete(grant.id);
    },
  };
}
export async function runAgentTurn(
  backend: AgentSession,
  control: SessionControl,
  projectId: string,
) {
  const selected = await prisma.$transaction(async (db) => {
    await lockProject(db, projectId);
    const turn = await db.agentTurn.findFirst({
      where: {
        projectId,
        stoppedAt: null,
        OR: [{ state: 'queued' }, { heartbeatAt: { lt: new Date(Date.now() - 90000) } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!turn) return null;
    await db.agentTurn.update({
      where: { id: turn.id },
      data: { state: turn.state === 'queued' ? 'running' : 'unknown', heartbeatAt: new Date() },
    });
    return turn;
  });
  if (!selected) return false;
  const grant = selected.grant as unknown as AgentGrant;
  const thread = await prisma.conversationThread.findUniqueOrThrow({
    where: { id: grant.threadId },
  });
  grant.providerId = thread.providerId;
  grant.providerState = thread.providerState;
  if (!grant.providerId) {
    const previous = await prisma.comments.findMany({
      where: { threadId: grant.threadId, created_at: { lt: selected.createdAt } },
      orderBy: { created_at: 'desc' },
      take: 30,
      include: { users: { select: { kind: true } } },
    });
    if (previous.length)
      grant.instructions +=
        '\nEarlier conversation, supplied as historical context only: ' +
        JSON.stringify(
          previous.reverse().map((comment) => ({ role: comment.users.kind, body: comment.body })),
        ).slice(-32000);
  }
  if (selected.state !== 'queued') {
    const proof = await backend.recover(grant);
    await control.finish(
      grant,
      proof ?? 'no-sandbox-allocated',
      'The previous runtime disconnected. It was stopped before allowing another turn.',
    );
  } else if (selected.stopRequested)
    await control.finish(grant, 'no-sandbox-allocated', 'Turn stopped before execution.');
  else await backend.run(grant);
  return true;
}
