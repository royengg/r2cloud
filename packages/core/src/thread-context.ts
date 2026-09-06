import type { DB } from '@r2cloud/database';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { codexModels } from '@r2cloud/contracts/threads';
export async function availableModels(db: DB, actor: Pick<Actor, 'id'>, projectId: string) {
  const connection = await db.codexConnection.findFirst({
    where: {
      projectId,
      userId: actor.id,
      state: 'connected',
      modelsUpdatedAt: { gt: new Date(Date.now() - 86400000) },
    },
    orderBy: { createdAt: 'desc' },
    select: { models: true },
  });
  const personal = codexModels.parse(connection?.models ?? []);
  const runtime = await db.executionRuntime.findFirst({
    where: { projectId, modelsUpdatedAt: { gt: new Date(Date.now() - 86400000) } },
    select: { models: true },
  });
  const supported = codexModels.parse(runtime?.models ?? []);
  return supported.filter((model) => personal.some((p) => p.model === model.model));
}
export async function pinThread(
  db: DB,
  actor: Pick<Actor, 'id'>,
  projectId: string,
  taskId: string,
  threadId: string,
  version?: number,
) {
  const thread = await db.conversationThread.findFirst({
    where: { id: threadId, projectId, taskId, archivedAt: null },
  });
  requireThat(thread, 404, 'Thread not found for this task.');
  requireThat(
    thread.version === version,
    409,
    'Thread settings changed. Review them before starting.',
  );
  const models = await availableModels(db, actor, projectId);
  if (thread.model)
    requireThat(
      models.some((m) => m.model === thread.model),
      409,
      'Choose a model available to the task owner’s Codex account.',
    );
  const messages = await db.comments.findMany({
    where: { threadId },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: 41,
    include: { users: { select: { kind: true } } },
  });
  requireThat(
    messages.length <= 40 && messages.reduce((n, m) => n + m.body.length, 0) <= 64000,
    409,
    'This thread has reached its context limit. Start a new thread for the next run.',
  );
  return {
    id: thread.id,
    version: thread.version,
    model: thread.model ?? models.find((m) => m.isDefault)?.model ?? null,
    instructions: thread.instructions,
    history: messages
      .reverse()
      .map((m) => ({ role: m.users.kind === 'agent' ? 'assistant' : 'user', body: m.body })),
  };
}
