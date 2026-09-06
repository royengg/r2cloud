import { receipt } from './receipt';
import { pinThread } from './thread-context';
import { access, event, type AccessibleProject } from './project-context';
import { pinExecutionSetup } from './execution-setup';
import { type DB, type tasks, Prisma, prisma, json } from '@r2cloud/database';
import { lockRow } from '@r2cloud/database/locking';
import {
  type Actor,
  type Command,
  type TaskInput,
  type BatchInput,
  type Evidence,
  taskInput,
  commandInput,
  batchInput,
  requireThat,
} from '@r2cloud/contracts/domain';
import type { RunGrant } from '@r2cloud/contracts/adapters';
import { id } from '@r2cloud/contracts/hash';
export async function createTask(actor: Actor, projectId: string, key: string, input: TaskInput) {
  input = taskInput.parse(input);
  return receipt(actor, projectId, key, { type: 'create', input }, async (db) => {
    const p = await access(db, actor, projectId, 'contribute');
    const tid = id();
    await db.tasks.create({ data: { id: tid, org_id: p.org_id, project_id: projectId, ...input } });
    await event(db, projectId, tid, actor.id, 'Task created');
    return { id: tid };
  });
}
async function queueRun(
  db: DB,
  actor: Pick<Actor, 'id'>,
  p: AccessibleProject,
  t: tasks,
  claimId: string,
  minutes: number,
  budgetCents: number,
  thread?: RunGrant['config']['thread'],
  agentTurnId?: string,
) {
  const connection = await db.provider_connections.findFirst({
    where: { project_id: p.id, user_id: actor.id, enabled: true },
    select: { id: true, mode: true },
  });
  requireThat(
    connection,
    409,
    'Connect an AI account authorised for this project before starting work.',
  );
  requireThat(
    connection.mode !== 'managed' || budgetCents === 0,
    400,
    'This pilot only permits subscription usage with no paid overage.',
  );
  if (connection.mode === 'managed')
    requireThat(
      await db.executionRuntime.count({
        where: { projectId: p.id, expiresAt: { gt: new Date() } },
      }),
      409,
      'The managed execution worker is not available.',
    );
  const active =
    (await db.runs.count({ where: { org_id: p.org_id, stopped_at: null } })) +
    (await db.agentTurn.count({
      where: {
        orgId: p.org_id,
        stoppedAt: null,
        ...(agentTurnId ? { id: { not: agentTurnId } } : {}),
      },
    }));
  const org = await db.organisations.findUniqueOrThrow({ where: { id: p.org_id } });
  requireThat(active < org.max_runs, 409, 'The organisation has reached its concurrent run limit.');
  const skills = await db.skills.findMany({
    where: { project_id: p.id, enabled: true },
    select: { id: true, version: true, digest: true },
    orderBy: { id: 'asc' },
  });
  requireThat(p.repo_id, 409, 'Connect a repository before starting this task.');
  const repo = await db.repositories.findUniqueOrThrow({ where: { id: p.repo_id } });
  const runId = id(),
    gen = t.generation + 1;
  const executionSetup =
    connection.mode === 'fixture' ? null : await pinExecutionSetup(db, p.id, minutes, budgetCents);
  const manifest = {
    thread,
    agentTurnId,
    executionSetup,
    provider: 'codex',
    connectionId: connection.id,
    mode: connection.mode,
    repository: repo.full_name,
    baseSha: repo.base_sha,
    targetRef: repo.target_ref,
    minutes,
    budgetCents,
    skills,
    environment: {
      architecture: connection.mode === 'fixture' ? 'arm64' : 'provider-image',
      checkout:
        connection.mode === 'fixture' ? '/workspace/repository' : '/vercel/sandbox/repository',
      browserState: 'per-run',
      writeCredentials: false,
    },
    previousCandidate: t.candidate_id,
  };
  await db.runs.create({
    data: {
      id: runId,
      org_id: p.org_id,
      project_id: p.id,
      task_id: t.id,
      claim_id: claimId,
      generation: gen,
      state: 'queued',
      manifest: json(manifest),
    },
  });
  await db.tasks.update({
    where: { id: t.id },
    data: { state: 'building', generation: gen, candidate_id: null, version: { increment: 1 } },
  });
  if (!agentTurnId)
    await db.jobs.create({
      data: {
        id: id(),
        org_id: p.org_id,
        project_id: p.id,
        task_id: t.id,
        run_id: runId,
        kind: 'execute',
      },
    });
  await event(db, p.id, t.id, actor.id, 'Work started', {
    runId,
    generation: gen,
    minutes,
    budgetCents,
  });
  return { id: t.id, runId, generation: gen };
}
async function startTask(
  db: DB,
  actor: Actor,
  p: AccessibleProject,
  t: tasks,
  input: Extract<Command, { action: 'start' }>,
  agentTurnId?: string,
) {
  requireThat(p.repo_id, 409, 'Connect a repository before starting this task.');
  requireThat(t.state === 'todo', 409, 'This task already has an implementation owner.');
  const deps = await db.dependencies.count({
    where: {
      task_id: t.id,
      tasks_dependencies_org_id_project_id_depends_onTotasks: { state: { not: 'completed' } },
    },
  });
  requireThat(!deps, 409, 'Complete the prerequisite tasks before starting this work.');
  await lockRow(db, 'repositories', p.repo_id);
  const repo = await db.repositories.findUniqueOrThrow({ where: { id: p.repo_id } });
  const occupied = await db.claims.count({ where: { repo_id: p.repo_id, released_at: null } });
  requireThat(
    occupied < repo.max_changes,
    409,
    'Another change is awaiting completion in this repository. Its review or merge must finish first.',
  );
  const claimId = id();
  await db.claims.create({
    data: {
      id: claimId,
      org_id: p.org_id,
      project_id: p.id,
      task_id: t.id,
      owner_id: actor.id,
      repo_id: p.repo_id,
    },
  });
  const thread = input.threadId
    ? await pinThread(db, actor, p.id, t.id, input.threadId, input.threadVersion)
    : undefined;
  return queueRun(db, actor, p, t, claimId, input.minutes, input.budgetCents, thread, agentTurnId);
}
export async function command(
  actor: Actor,
  projectId: string,
  taskId: string,
  key: string,
  input: Command,
) {
  input = commandInput.parse(input);
  return receipt(actor, projectId, key, { taskId, input }, async (db) => {
    return commandInTransaction(db, actor, projectId, taskId, input);
  });
}
export async function commandInTransaction(
  db: DB,
  actor: Actor,
  projectId: string,
  taskId: string,
  input: Command,
  agentTurnId?: string,
) {
  const p = await access(
    db,
    actor,
    projectId,
    input.action === 'publish'
      ? 'review'
      : input.action === 'merge'
        ? 'merge'
        : input.action === 'changes'
          ? undefined
          : 'contribute',
  );
  await lockRow(db, 'tasks', taskId);
  const t = await db.tasks.findFirst({ where: { id: taskId, project_id: projectId } });
  requireThat(t, 404, 'Task not found.');
  requireThat(
    t.version === input.version,
    409,
    'This task has changed. Refresh and review the latest version.',
  );
  if (input.action === 'start') {
    if (input.message) {
      await db.comments.create({
        data: {
          id: id(),
          org_id: p.org_id,
          project_id: projectId,
          task_id: taskId,
          user_id: actor.id,
          body: input.message,
          threadId: input.threadId,
        },
      });
      await event(db, projectId, taskId, actor.id, 'Task instructions added');
    }
    return startTask(db, actor, p, t, input, agentTurnId);
  }
  const claim = await db.claims.findFirst({ where: { task_id: taskId, released_at: null } });
  requireThat(claim, 409, 'This task has no active claim.');
  if (input.action === 'changes') {
    requireThat(
      ['review', 'blocked'].includes(t.state),
      409,
      'Corrections can start when this candidate is ready for review.',
    );
    requireThat(
      p.review || claim.owner_id === actor.id,
      403,
      'Only the owner or a designated reviewer can request a correction.',
    );
    requireThat(
      !(await db.runs.count({ where: { claim_id: claim.id, stopped_at: null } })),
      409,
      'The previous execution has not been confirmed stopped.',
    );
    await db.approvals.updateMany({
      where: { task_id: taskId, consumed_at: null },
      data: { revoked_at: new Date() },
    });
    await db.comments.create({
      data: {
        id: id(),
        org_id: p.org_id,
        project_id: projectId,
        task_id: taskId,
        user_id: actor.id,
        body: input.feedback,
        threadId: input.threadId,
      },
    });
    await event(db, projectId, taskId, actor.id, 'Changes requested', {
      feedback: input.feedback,
    });
    const owner = await db.users.findUniqueOrThrow({ where: { id: claim.owner_id } });
    await access(db, owner, projectId, 'contribute');
    const previous = await db.runs.findFirstOrThrow({
      where: { claim_id: claim.id },
      orderBy: { generation: 'desc' },
      select: { manifest: true },
    });
    const config = previous.manifest as unknown as RunGrant['config'];
    const thread = input.threadId
      ? await pinThread(db, owner, projectId, taskId, input.threadId, input.threadVersion)
      : undefined;
    return queueRun(
      db,
      owner,
      p,
      t,
      claim.id,
      config.minutes,
      config.budgetCents,
      thread,
      agentTurnId,
    );
  }
  requireThat(
    t.state === (input.action === 'publish' ? 'review' : 'code_review'),
    409,
    'This action is not available at this stage.',
  );
  const c = await db.candidates.findFirst({ where: { id: input.candidateId, task_id: taskId } });
  requireThat(
    c && c.id === t.candidate_id && c.generation === t.generation && c.digest === input.digest,
    409,
    'The candidate has changed. Review and approve the current snapshot.',
  );
  const evidence = c.evidence as unknown as Evidence;
  requireThat(
    evidence.checks.length > 0 && evidence.checks.every((x) => x.status === 'passed'),
    409,
    'Acceptance checks must pass before publication.',
  );
  if (input.action === 'merge')
    requireThat(
      await db.publications.count({ where: { task_id: taskId, candidate_id: c.id } }),
      409,
      'A verified pull request is required.',
    );
  const approvalId = id(),
    operationId = id();
  await db.approvals.create({
    data: {
      id: approvalId,
      org_id: p.org_id,
      project_id: projectId,
      task_id: taskId,
      candidate_id: c.id,
      action: input.action,
      digest: c.digest,
      approver_id: actor.id,
      policy_version: 'v1',
      expires_at: new Date(Date.now() + 30 * 60_000),
    },
  });
  await db.jobs.create({
    data: {
      id: operationId,
      org_id: p.org_id,
      project_id: projectId,
      task_id: taskId,
      approval_id: approvalId,
      kind: input.action,
    },
  });
  await db.tasks.update({
    where: { id: taskId },
    data: {
      state: input.action === 'publish' ? 'publishing' : 'merging',
      version: { increment: 1 },
    },
  });
  await event(
    db,
    projectId,
    taskId,
    actor.id,
    input.action === 'publish' ? 'Publication authorised' : 'Merge authorised',
    { candidateId: c.id, digest: c.digest, operationId },
  );
  return { id: taskId, approvalId, operationId };
}
export async function addComment(
  actor: Actor,
  projectId: string,
  taskId: string | null,
  key: string,
  body: string,
) {
  return receipt(actor, projectId, key, { type: 'comment', taskId, body }, async (db) => {
    const p = await access(db, actor, projectId, 'contribute');
    requireThat(
      body.trim().length > 0 && body.length <= 8000,
      400,
      'Write a message of up to 8,000 characters.',
    );
    if (taskId)
      requireThat(
        await db.tasks.count({ where: { id: taskId, project_id: projectId } }),
        404,
        'Task not found.',
      );
    const commentId = id();
    await db.comments.create({
      data: {
        id: commentId,
        org_id: p.org_id,
        project_id: projectId,
        task_id: taskId,
        user_id: actor.id,
        body,
      },
    });
    await event(db, projectId, taskId, actor.id, 'Feedback added');
    return { id: commentId };
  });
}
export async function snapshot(actor: Actor, projectId: string) {
  return prisma.$transaction(
    async (db) => {
      const project = {
        ...(await access(db, actor, projectId)),
        provider_connected: Boolean(
          await db.provider_connections.count({
            where: { project_id: projectId, user_id: actor.id, enabled: true },
          }),
        ),
      };
      const rows = await db.tasks.findMany({
        where: { project_id: projectId },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        include: {
          claims: {
            orderBy: { created_at: 'desc' },
            take: 1,
            include: {
              users: { select: { name: true, kind: true } },
            },
          },
          candidates: { include: { publications: { take: 1 } } },
        },
      });
      const runs = await db.runs.findMany({
        where: {
          project_id: projectId,
          OR: rows.map((task) => ({ task_id: task.id, generation: task.generation })),
        },
      });
      const threadIds = runs.flatMap((run) => {
        const thread = (run.manifest as unknown as RunGrant['config']).thread;
        return thread ? [thread.id] : [];
      });
      const threads = await db.conversationThread.findMany({
        where: { projectId, id: { in: threadIds } },
        select: { id: true, title: true },
      });
      const threadNames = new Map(threads.map((thread) => [thread.id, thread.title]));
      const currentRuns = new Map(
        runs.map((run) => {
          const thread = (run.manifest as unknown as RunGrant['config']).thread;
          return [
            run.task_id,
            { ...run, thread_title: thread ? (threadNames.get(thread.id) ?? null) : null },
          ];
        }),
      );
      const activeTurns = await db.agentTurn.findMany({
        where: { projectId, stoppedAt: null, thread: { taskId: { not: null } } },
        orderBy: { createdAt: 'asc' },
        select: { state: true, thread: { select: { taskId: true, title: true, model: true } } },
      });
      const taskAgents = new Map<
        string,
        { state: string; threadTitle: string; model: string | null; count: number }
      >();
      for (const turn of activeTurns) {
        const key = turn.thread.taskId!;
        const existing = taskAgents.get(key);
        if (existing) existing.count++;
        else
          taskAgents.set(key, {
            state: turn.state,
            threadTitle: turn.thread.title,
            model: turn.thread.model,
            count: 1,
          });
      }
      const tasks = rows.map(({ claims, candidates, ...task }) => {
        const claim = claims[0];
        const candidate = candidates && {
          id: candidates.id,
          digest: candidates.digest,
          manifest: candidates.manifest,
          evidence: candidates.evidence,
        };
        return {
          ...task,
          owner_name: claim?.users.name ?? null,
          owner_id: claim?.owner_id ?? null,
          owner_kind: claim?.users.kind ?? 'human',
          run: currentRuns.get(task.id) ?? null,
          agent: taskAgents.get(task.id) ?? null,
          candidate,
          publication: candidates?.publications[0] ?? null,
        };
      });
      const grants = await db.project_access.findMany({
        where: { project_id: projectId, memberships: { users: { kind: 'human' } } },
        include: { memberships: { include: { users: true } } },
        orderBy: { memberships: { users: { name: 'asc' } } },
      });
      const participants = grants.map((g) => ({
        id: g.user_id,
        name: g.memberships.users.name,
        contribute: g.contribute,
        review: g.review,
        merge: g.merge,
      }));
      const commentRows = await db.comments.findMany({
        where: { project_id: projectId },
        include: { users: { select: { name: true } } },
        orderBy: { created_at: 'asc' },
      });
      const comments = commentRows.map(({ users, ...comment }) => ({
        ...comment,
        name: users.name,
      }));
      const events = await db.events.findMany({
        where: { project_id: projectId },
        orderBy: { id: 'desc' },
        take: 100,
      });
      return { project, tasks, participants, comments, events, cursor: events[0]?.id ?? '0' };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function projects(actor: Actor) {
  const rows = await prisma.projects.findMany({
    where: { project_access: { some: { user_id: actor.id, memberships: { user_id: actor.id } } } },
    include: {
      organisations: {
        select: {
          name: true,
          memberships: { where: { user_id: actor.id }, select: { role: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
  return rows.map(({ organisations, ...p }) => ({
    ...p,
    org_name: organisations.name,
    workspace_role: organisations.memberships[0]?.role,
  }));
}
/** Explicit, all-or-nothing batches. No authority beyond named tasks. */
export async function startBatch(actor: Actor, projectId: string, key: string, input: BatchInput) {
  input = batchInput.parse(input);
  requireThat(
    input.tasks.length * input.budgetCentsPerTask <= input.maxTotalBudgetCents,
    400,
    'The batch exceeds its total authorised budget.',
  );
  return receipt(actor, projectId, key, { type: 'batch', input }, async (db) => {
    const p = await access(db, actor, projectId, 'contribute');
    const results = [];
    for (const selected of [...input.tasks].sort((a, b) => a.taskId.localeCompare(b.taskId))) {
      await lockRow(db, 'tasks', selected.taskId);
      const t = await db.tasks.findFirst({ where: { id: selected.taskId, project_id: projectId } });
      requireThat(t, 404, 'A selected task does not belong to this project.');
      requireThat(
        t.version === selected.version,
        409,
        'A selected task has changed. Review the batch again.',
      );
      results.push(
        await startTask(db, actor, p, t, {
          action: 'start',
          version: t.version,
          minutes: input.minutesPerTask,
          budgetCents: input.budgetCentsPerTask,
        }),
      );
    }
    await event(db, projectId, null, actor.id, 'Bounded batch authorised', {
      tasks: results.map((r) => r.id),
      minutesPerTask: input.minutesPerTask,
      maxTotalBudgetCents: input.maxTotalBudgetCents,
    });
    return { tasks: results };
  });
}
