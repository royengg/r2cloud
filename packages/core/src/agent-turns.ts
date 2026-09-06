import { prisma, json, type DB } from '@r2cloud/database';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { agentInput, type AgentGrant, type AgentTimeline } from '@r2cloud/contracts/agent';
import { id } from '@r2cloud/contracts/hash';
import { access, event } from './project-context';
import { receipt } from './receipt';
import { availableModels } from './thread-context';

export async function queueAgentTurn(
  db: DB,
  actor: Actor,
  projectId: string,
  threadId: string,
  message: string,
) {
  const project = await access(db, actor, projectId, 'contribute');
  const thread = await db.conversationThread.findFirst({
    where: { id: threadId, projectId, archivedAt: null },
  });
  requireThat(thread, 404, 'Thread not found.');
  requireThat(
    !(await db.agentTurn.count({ where: { threadId, stoppedAt: null } })),
    409,
    'Wait for this turn or stop it before sending another message.',
  );
  requireThat(
    !thread.taskId ||
      !(await db.runs.count({ where: { task_id: thread.taskId, stopped_at: null } })),
    409,
    'The task is still running.',
  );
  const connection = await db.provider_connections.findFirst({
    where: { project_id: projectId, user_id: actor.id, enabled: true, mode: 'managed' },
  });
  requireThat(connection, 409, 'Connect your Codex account before sending a message.');
  requireThat(
    await db.executionRuntime.count({ where: { projectId, expiresAt: { gt: new Date() } } }),
    409,
    'The managed agent worker is not available.',
  );
  const org = await db.organisations.findUniqueOrThrow({ where: { id: project.org_id } });
  const active =
    (await db.agentTurn.count({ where: { orgId: project.org_id, stoppedAt: null } })) +
    (await db.runs.count({ where: { org_id: project.org_id, stopped_at: null } }));
  requireThat(active < org.max_runs, 409, 'The organisation has reached its concurrent run limit.');
  const models = await availableModels(db, actor, projectId);
  requireThat(
    !thread.model || models.some((m) => m.model === thread.model),
    409,
    'Choose an available Codex model.',
  );
  const previous = await db.agentTurn.findFirst({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    include: { items: { select: { kind: true } } },
  });
  requireThat(
    !previous?.error ||
      previous.items.some((item) => item.kind === 'checkpoint') ||
      !previous.items.some((item) => !['userMessage', 'error'].includes(item.kind)),
    409,
    'The previous native session could not be recovered. Start a new thread; the saved messages remain available here.',
  );
  const turnId = id();
  const grant: AgentGrant = {
    id: turnId,
    projectId,
    orgId: project.org_id,
    threadId,
    actorId: actor.id,
    connectionId: connection.id,
    model: thread.model ?? models.find((m) => m.isDefault)?.model ?? null,
    instructions: thread.instructions,
    message,
    providerId: null,
    providerState: null,
    taskId: thread.taskId,
    minutes: 10,
  };
  await db.agentTurn.create({
    data: {
      id: turnId,
      orgId: project.org_id,
      projectId,
      threadId,
      actorId: actor.id,
      grant: json(grant),
    },
  });
  await db.agentItem.create({
    data: {
      id: id(),
      turnId,
      sourceId: 'user',
      kind: 'userMessage',
      text: message,
      detail: json({
        authorName: (await db.users.findUniqueOrThrow({ where: { id: actor.id } })).name,
      }),
      status: 'completed',
    },
  });
  await db.comments.create({
    data: {
      id: id(),
      org_id: project.org_id,
      project_id: projectId,
      task_id: thread.taskId,
      threadId,
      user_id: actor.id,
      body: message,
    },
  });
  await event(db, projectId, thread.taskId, actor.id, 'Agent turn queued', { threadId, turnId });
}
export async function agentTimeline(
  actor: Actor,
  projectId: string,
  threadId: string,
): Promise<AgentTimeline> {
  return prisma.$transaction(async (db) => {
    await access(db, actor, projectId);
    requireThat(
      await db.conversationThread.count({ where: { id: threadId, projectId, archivedAt: null } }),
      404,
      'Thread not found.',
    );
    const turns = await db.agentTurn.findMany({
      where: { threadId, projectId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const items = await db.agentItem.findMany({
      where: { turnId: { in: turns.map((t) => t.id) }, kind: { not: 'checkpoint' } },
      orderBy: { revision: 'desc' },
      take: 1000,
    });
    const requests = await db.agentRequest.findMany({
      where: { turnId: turns[0]?.id ?? '' },
      orderBy: { id: 'asc' },
    });
    const cursor = await db.events.aggregate({
      where: { project_id: projectId },
      _max: { id: true },
    });
    return {
      cursor: String(cursor._max.id ?? 0),
      state: turns[0]?.state ?? 'idle',
      turnId: turns[0]?.id ?? null,
      actorId: turns[0]?.actorId ?? null,
      items: items.reverse().map(({ revision, sourceId, ...item }) => ({
        ...item,
        detail: item.detail as Record<string, unknown>,
      })),
      requests: requests.map((r) => ({
        id: r.id,
        kind: r.kind,
        prompt: r.prompt,
        detail: r.detail as Record<string, unknown>,
        resolved: r.response !== null,
      })),
    };
  });
}
export async function agentCommand(
  actor: Actor,
  projectId: string,
  threadId: string,
  key: string,
  raw: unknown,
) {
  const input = agentInput.parse(raw);
  return receipt(actor, projectId, key, { threadId, input }, async (db) => {
    await access(db, actor, projectId, 'contribute');
    const turn = await db.agentTurn.findFirst({ where: { threadId, projectId, stoppedAt: null } });
    requireThat(turn, 409, 'This turn has already stopped.');
    requireThat(
      turn.actorId === actor.id,
      403,
      'Only the person who started this turn can respond or stop it.',
    );
    if (input.action === 'stop')
      await db.agentTurn.update({ where: { id: turn.id }, data: { stopRequested: true } });
    else {
      const request = await db.agentRequest.findFirst({
        where: { id: input.requestId, turnId: turn.id },
      });
      requireThat(
        request && request.response === null,
        409,
        'This request is no longer waiting for a response.',
      );
      requireThat(
        request.kind === 'question' ? input.answers !== undefined : input.approved !== undefined,
        400,
        'Provide a response to this request.',
      );
      if (request.kind === 'question') {
        const questions = (request.detail as { questions: { id: string }[] }).questions;
        requireThat(
          questions.length > 0 &&
            Object.keys(input.answers!).length === questions.length &&
            questions.every((question) =>
              input.answers![question.id]?.some((answer) => answer.trim().length > 0),
            ),
          400,
          'Answer each question before continuing.',
        );
      }
      await db.agentItem.create({
        data: {
          id: id(),
          turnId: turn.id,
          sourceId: `response:${request.id}`,
          kind: 'userMessage',
          text:
            request.kind === 'question'
              ? Object.values(input.answers!).flat().join('\n')
              : `${input.approved ? 'Approved' : 'Declined'}: ${request.prompt}`,
          status: 'completed',
          detail: json({
            authorName: (await db.users.findUniqueOrThrow({ where: { id: actor.id } })).name,
          }),
        },
      });
      await db.agentRequest.update({
        where: { id: request.id },
        data: { response: json(input), resolvedBy: actor.id },
      });
    }
    await event(db, projectId, null, actor.id, 'Agent input received', {
      threadId,
      turnId: turn.id,
    });
    return { id: threadId };
  });
}
export async function activeAgentTurn(grant: AgentGrant) {
  const turn = await prisma.agentTurn.findFirst({
    where: {
      id: grant.id,
      projectId: grant.projectId,
      threadId: grant.threadId,
      actorId: grant.actorId,
      stoppedAt: null,
      state: { in: ['running', 'waiting'] },
    },
  });
  requireThat(turn, 409, 'The agent turn is no longer active.');
  await access(prisma, { id: grant.actorId }, grant.projectId, 'contribute');
  return turn;
}
