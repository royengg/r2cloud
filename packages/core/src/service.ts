import { changeTaskOwnership, requireTaskAssignee, managesTasks } from './task-ownership';
import { checkExecutionCapacity, checkTaskStart } from './implementation-admission';
import { receipt } from './receipt';
import { pinThread } from './thread-context';
import { access, event, type AccessibleProject } from './project-context';
import { ensureExecutionSetup, pinExecutionSetup } from './execution-setup';
import { type DB, type tasks, Prisma, prisma, json } from '@r2cloud/database';
import { lockRow } from '@r2cloud/database/locking';
import {
  type Actor,
  type Command,
  type TaskInput,
  type BatchInput,
  type Evidence,
  type CandidateManifest,
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
  await checkExecutionCapacity(db, p.org_id, agentTurnId);
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
    data: {
      state: 'building',
      board_status: 'ongoing',
      work_started_at: t.work_started_at ?? new Date(),
      generation: gen,
      candidate_id: null,
      version: { increment: 1 },
    },
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
  requireTaskAssignee(t, actor.id);
  await checkTaskStart(db, t);
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
  if (input.action === 'start' || input.action === 'changes') {
    await access(prisma, actor, projectId, 'contribute');
    const task = await prisma.tasks.findFirst({ where: { id: taskId, project_id: projectId } });
    requireThat(task, 404, 'Task not found.');
    requireTaskAssignee(task, actor.id);
    const managed = await prisma.provider_connections.count({
      where: { project_id: projectId, user_id: actor.id, enabled: true, mode: 'managed' },
    });
    if (managed && !(input.action === 'start' && input.budgetCents > 0))
      await ensureExecutionSetup(actor, projectId);
  }
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
  if (input.action === 'assign' || input.action === 'move')
    return changeTaskOwnership(db, actor, p, t, input);
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
  if (input.action === 'release') {
    requireThat(
      p.actor_kind === 'human' && (t.assignee_id === actor.id || managesTasks(p)),
      403,
      'Only the assignee or a workspace owner or admin can release this task.',
    );
    requireThat(
      t.state === 'blocked' && !t.candidate_id,
      409,
      'Only a stopped task without a candidate can return to Todo.',
    );
    requireThat(
      !(await db.runs.count({
        where: { claim_id: claim.id, OR: [{ stopped_at: null }, { stop_proof: null }] },
      })),
      409,
      'Every execution must be confirmed stopped before releasing this task.',
    );
    requireThat(
      !(await db.agentTurn.count({ where: { thread: { taskId }, stoppedAt: null } })),
      409,
      'Stop the task’s active agent turn before releasing it.',
    );
    const stoppedRuns = await db.runs.findMany({
      where: { task_id: taskId, stopped_at: { not: null }, stop_proof: { not: null } },
      select: { id: true },
    });
    requireThat(
      !(await db.jobs.count({
        where: {
          task_id: taskId,
          NOT: {
            OR: [
              { state: 'done' },
              {
                kind: 'execute',
                state: 'blocked',
                run_id: { in: stoppedRuns.map((run) => run.id) },
              },
            ],
          },
        },
      })),
      409,
      'Resolve pending operations before releasing this task.',
    );
    requireThat(
      !(await db.publications.count({ where: { task_id: taskId } })),
      409,
      'A published task cannot be released this way.',
    );
    await lockRow(db, 'repositories', claim.repo_id);
    await db.approvals.updateMany({
      where: { task_id: taskId, consumed_at: null },
      data: { revoked_at: new Date() },
    });
    await db.claims.update({ where: { id: claim.id }, data: { released_at: new Date() } });
    await db.tasks.update({
      where: { id: taskId },
      data: {
        state: 'todo',
        board_status: 'todo',
        work_started_at: null,
        version: { increment: 1 },
      },
    });
    await event(db, projectId, taskId, actor.id, 'Stopped task returned to Todo');
    return { id: taskId };
  }
  if (input.action === 'changes') {
    requireTaskAssignee(t, actor.id);
    requireTaskAssignee(t, claim.owner_id);
    requireThat(
      ['review', 'blocked'].includes(t.state),
      409,
      'Corrections can start when this candidate is ready for review.',
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
  const retry =
    t.state === 'blocked'
      ? await db.jobs.findFirst({
          where: {
            task_id: taskId,
            kind: input.action,
            state: 'blocked',
            approvals: { candidate_id: t.candidate_id ?? '' },
          },
          orderBy: { created_at: 'desc' },
        })
      : null;
  requireThat(
    !!retry || t.state === (input.action === 'publish' ? 'review' : 'code_review'),
    409,
    'This action is not available at this stage.',
  );
  const c = await db.candidates.findFirst({ where: { id: input.candidateId, task_id: taskId } });
  requireThat(
    c && c.id === t.candidate_id && c.generation === t.generation && c.digest === input.digest,
    409,
    'The candidate has changed. Review and approve the current snapshot.',
  );
  requireThat(
    (c.manifest as unknown as CandidateManifest).fixture ||
      process.env.R2_GITHUB_PUBLICATION_ENABLED === 'true',
    409,
    'GitHub publication is not configured. Ask a workspace administrator to enable the publisher.',
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
    operationId = retry?.id ?? id();
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
  if (retry) {
    await db.approvals.updateMany({
      where: { id: retry.approval_id! },
      data: { revoked_at: new Date() },
    });
    const updated = await db.jobs.updateMany({
      where: { id: retry.id, state: 'blocked' },
      data: {
        approval_id: approvalId,
        state: 'ready',
        error: null,
        attempts: 0,
        available_at: new Date(),
        lease_until: null,
      },
    });
    requireThat(updated.count === 1, 409, 'Publication is already being retried.');
  } else
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
          assignee: { select: { id: true, name: true } },
          jobs: {
            where: { kind: { in: ['publish', 'merge'] } },
            orderBy: { created_at: 'desc' },
            take: 1,
            select: {
              kind: true,
              state: true,
              error: true,
              approvals: { select: { candidate_id: true } },
            },
          },
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
      const tasks = rows.map(({ claims, candidates, assignee, jobs, ...task }) => {
        const claim = claims[0];
        const candidate = candidates && {
          id: candidates.id,
          digest: candidates.digest,
          manifest: candidates.manifest,
          evidence: candidates.evidence,
        };
        return {
          ...task,
          assignee_name: assignee?.name ?? null,
          owner_name: task.board_status === 'ongoing' ? (assignee?.name ?? null) : null,
          owner_id: task.board_status === 'ongoing' ? task.assignee_id : null,
          owner_kind: claim?.users.kind ?? 'human',
          run: currentRuns.get(task.id) ?? null,
          agent: taskAgents.get(task.id) ?? null,
          candidate,
          publication: candidates?.publications[0] ?? null,
          publicationOperation:
            jobs[0]?.approvals?.candidate_id === task.candidate_id
              ? { kind: jobs[0].kind, state: jobs[0].state, error: jobs[0].error }
              : null,
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
