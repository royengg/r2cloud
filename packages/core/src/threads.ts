import { prisma } from '@r2cloud/database';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { threadCommand } from '@r2cloud/contracts/threads';
import { id } from '@r2cloud/contracts/hash';
import { access, event } from './project-context';
import { receipt } from './receipt';
import { availableModels } from './thread-context';
import { commandInTransaction } from './service';
export async function readThreads(actor: Actor, projectId: string, threadId?: string) {
  return prisma.$transaction(async (db) => {
    await access(db, actor, projectId);
    if (threadId) {
      const thread = await db.conversationThread.findFirst({
        where: { id: threadId, projectId, archivedAt: null },
      });
      requireThat(thread, 404, 'Thread not found.');
      const messages = await db.comments.findMany({
        where: { project_id: projectId, threadId },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 100,
        include: { users: { select: { name: true, kind: true } } },
      });
      const task = thread.taskId
        ? await db.tasks.findUnique({
            where: { id: thread.taskId },
            select: { id: true, title: true, state: true, version: true },
          })
        : null;
      const run = thread.taskId
        ? await db.runs.findFirst({
            where: { task_id: thread.taskId },
            orderBy: { generation: 'desc' },
            select: { id: true, state: true, stopped_at: true },
          })
        : null;
      const failure =
        task?.state === 'blocked' && run
          ? await db.jobs.findFirst({
              where: { run_id: run.id, kind: 'execute', error: { not: null } },
              select: { error: true },
            })
          : null;
      const activity = task
        ? await db.events.findFirst({
            where: { task_id: task.id },
            orderBy: { id: 'desc' },
            select: { kind: true },
          })
        : null;
      return {
        activity: activity?.kind ?? null,
        failure: failure?.error ?? null,
        thread,
        task,
        run,
        messages: messages
          .reverse()
          .map(({ users, ...m }) => ({ ...m, name: users.name, role: users.kind })),
      };
    }
    return {
      threads: await db.conversationThread.findMany({
        where: { projectId, archivedAt: null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
      models: await availableModels(db, actor, projectId),
    };
  });
}
export async function changeThread(
  actor: Actor,
  projectId: string,
  threadId: string | null,
  key: string,
  raw: unknown,
) {
  const input = threadCommand.parse(raw);
  return receipt(actor, projectId, key, { threadId, input }, async (db) => {
    const project = await access(db, actor, projectId, 'contribute');
    if (input.action === 'create') {
      requireThat(threadId === null, 400, 'Use the thread creation endpoint.');
      if (input.taskId)
        requireThat(
          await db.tasks.count({ where: { id: input.taskId, project_id: projectId } }),
          404,
          'Task not found.',
        );
      requireThat(
        (await db.conversationThread.count({ where: { projectId, archivedAt: null } })) < 100,
        409,
        'Archive an older thread before creating another.',
      );
      if (input.model)
        requireThat(
          (await availableModels(db, actor, projectId)).some((m) => m.model === input.model),
          409,
          'This model is not available to your Codex account.',
        );
      const thread = await db.conversationThread.create({
        data: {
          id: id(),
          orgId: project.org_id,
          projectId,
          taskId: input.taskId,
          createdBy: actor.id,
          title: input.title,
          model: input.model,
          instructions: input.instructions,
        },
      });
      await event(db, projectId, input.taskId, actor.id, 'Conversation started', {
        threadId: thread.id,
      });
      return { id: thread.id };
    }
    const thread = await db.conversationThread.findFirst({
      where: { id: threadId ?? '', projectId, archivedAt: null },
    });
    requireThat(thread, 404, 'Thread not found.');
    if (input.action !== 'message')
      requireThat(
        thread.version === input.version,
        409,
        'This thread changed. Reload before continuing.',
      );
    if (input.action === 'update' || input.action === 'archive') {
      requireThat(
        actor.id === thread.createdBy || project.review,
        403,
        'Only the author or a project reviewer can change this thread.',
      );
      requireThat(
        !thread.taskId ||
          !(await db.runs.count({ where: { task_id: thread.taskId, stopped_at: null } })),
        409,
        'Wait until the task execution has stopped.',
      );
      if (input.action === 'update' && input.model)
        requireThat(
          (await availableModels(db, actor, projectId)).some((m) => m.model === input.model),
          409,
          'This model is not available to your Codex account.',
        );
      await db.conversationThread.update({
        where: { id: thread.id },
        data: {
          ...(input.action === 'archive'
            ? { archivedAt: new Date() }
            : { title: input.title, model: input.model, instructions: input.instructions }),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    } else {
      if (input.action === 'run') {
        let task = thread.taskId
          ? await db.tasks.findUniqueOrThrow({ where: { id: thread.taskId } })
          : null;
        if (!task) {
          task = await db.tasks.create({
            data: {
              id: id(),
              org_id: project.org_id,
              project_id: projectId,
              title: thread.title,
              priority: 'Medium',
              outcome: input.body,
              criteria: ['The requested outcome is implemented and ready for human review.'],
            },
          });
          await db.conversationThread.update({
            where: { id: thread.id },
            data: { taskId: task.id },
          });
          await db.comments.updateMany({
            where: { threadId: thread.id },
            data: { task_id: task.id },
          });
          await event(db, projectId, task.id, actor.id, 'Task created from conversation', {
            threadId: thread.id,
          });
        } else
          requireThat(
            task.version === input.taskVersion,
            409,
            'The task changed. Review its current state before running.',
          );
        requireThat(
          ['todo', 'review', 'blocked'].includes(task.state),
          409,
          'This task is already running or awaiting code review.',
        );
        if (task.state !== 'todo')
          requireThat(
            await db.claims.count({
              where: { task_id: task.id, owner_id: actor.id, released_at: null },
            }),
            403,
            'Only the implementation owner can run another turn.',
          );
        if (task.state === 'todo')
          await db.comments.create({
            data: {
              id: id(),
              org_id: project.org_id,
              project_id: projectId,
              task_id: task.id,
              threadId: thread.id,
              user_id: actor.id,
              body: input.body,
            },
          });
        await commandInTransaction(
          db,
          actor,
          projectId,
          task.id,
          task.state === 'todo'
            ? {
                action: 'start',
                version: task.version,
                minutes: 10,
                budgetCents: 0,
                threadId: thread.id,
                threadVersion: thread.version,
              }
            : {
                action: 'changes',
                version: task.version,
                feedback: input.body,
                threadId: thread.id,
                threadVersion: thread.version,
              },
        );
      } else
        await db.comments.create({
          data: {
            id: id(),
            org_id: project.org_id,
            project_id: projectId,
            task_id: thread.taskId,
            threadId: thread.id,
            user_id: actor.id,
            body: input.body,
          },
        });
      await db.conversationThread.update({
        where: { id: thread.id },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
    }
    await event(
      db,
      projectId,
      thread.taskId,
      actor.id,
      input.action === 'run' ? 'Conversation run authorised' : 'Conversation updated',
      { threadId: thread.id },
    );
    return { id: thread.id };
  });
}
