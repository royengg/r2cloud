import { type DB, pool, prisma, transaction } from './db';
import {
  type Actor,
  type Command,
  type TaskInput,
  type BatchInput,
  taskInput,
  commandInput,
  batchInput,
  requireThat,
} from '@r2cloud/contracts/domain';
import { digest, id } from '@r2cloud/contracts/hash';
export async function access(
  db: DB,
  actor: Actor,
  projectId: string,
  capability?: 'contribute' | 'review' | 'merge',
) {
  const row = (
    await db.query(
      'SELECT p.*,a.contribute,a.review,a.merge,u.kind actor_kind FROM projects p JOIN project_access a ON a.project_id=p.id AND a.org_id=p.org_id JOIN memberships m ON m.org_id=p.org_id AND m.user_id=a.user_id JOIN users u ON u.id=a.user_id WHERE p.id=$1 AND a.user_id=$2',
      [projectId, actor.id],
    )
  ).rows[0];
  requireThat(row, 403, 'You do not have access to this project.');
  if (capability)
    requireThat(row[capability], 403, `This action requires project ${capability} permission.`);
  if (capability === 'review' || capability === 'merge')
    requireThat(row.actor_kind === 'human', 403, 'A person must authorise this action.');
  return row;
}
export async function lockProject(db: DB, projectId: string) {
  // Fixed lock order coordinates project events and organisation/repository limits across API/worker processes.
  const p = (await db.query('SELECT org_id FROM projects WHERE id=$1', [projectId])).rows[0];
  requireThat(p, 404, 'Project not found.');
  await db.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE', [p.org_id]);
  await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
}
export async function event(
  db: DB,
  projectId: string,
  taskId: string | null,
  actorId: string | null,
  kind: string,
  detail: unknown = {},
) {
  await db.query(
    'INSERT INTO events(org_id,project_id,task_id,actor_id,kind,detail) SELECT org_id,id,$2,$3,$4,$5 FROM projects WHERE id=$1',
    [projectId, taskId, actorId, kind, JSON.stringify(detail)],
  );
}
async function receipt<T>(
  actor: Actor,
  projectId: string,
  key: string,
  payload: unknown,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid idempotency key is required.');
  return transaction(async (db) => {
    await access(db, actor, projectId);
    await lockProject(db, projectId);
    const prev = (
      await db.query('SELECT * FROM receipts WHERE user_id=$1 AND project_id=$2 AND key=$3', [
        actor.id,
        projectId,
        key,
      ])
    ).rows[0];
    const d = digest(payload);
    if (prev) {
      requireThat(
        prev.payload_hash === d,
        409,
        'This request key was already used for different content.',
      );
      return prev.response;
    }
    const result = await fn(db);
    await db.query('INSERT INTO receipts VALUES($1,$2,$3,$4,$5)', [
      actor.id,
      projectId,
      key,
      d,
      JSON.stringify(result),
    ]);
    return result;
  });
}
export async function createTask(actor: Actor, projectId: string, key: string, input: TaskInput) {
  input = taskInput.parse(input);
  return receipt(actor, projectId, key, { type: 'create', input }, async (db) => {
    const p = await access(db, actor, projectId, 'contribute');
    const tid = id();
    await db.query(
      'INSERT INTO tasks(id,org_id,project_id,title,outcome,criteria,priority) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        tid,
        p.org_id,
        projectId,
        input.title,
        input.outcome,
        JSON.stringify(input.criteria),
        input.priority,
      ],
    );
    await event(db, projectId, tid, actor.id, 'Task created');
    return { id: tid };
  });
}
async function queueRun(
  db: DB,
  actor: Actor,
  p: any,
  t: any,
  claimId: string,
  minutes: number,
  budgetCents: number,
) {
  const connection = (
    await db.query(
      'SELECT id,mode FROM provider_connections WHERE project_id=$1 AND user_id=$2 AND enabled=true',
      [p.id, actor.id],
    )
  ).rows[0];
  requireThat(
    connection,
    409,
    'Connect an AI account authorised for this project before starting work.',
  );
  const active = (
    await db.query('SELECT count(*)::int n FROM runs WHERE org_id=$1 AND stopped_at IS NULL', [
      p.org_id,
    ])
  ).rows[0].n;
  const org = (await db.query('SELECT max_runs FROM organisations WHERE id=$1', [p.org_id]))
    .rows[0];
  requireThat(active < org.max_runs, 409, 'The organisation has reached its concurrent run limit.');
  const skills = (
    await db.query(
      'SELECT id,version,digest FROM skills WHERE project_id=$1 AND enabled=true ORDER BY id',
      [p.id],
    )
  ).rows;
  const repo = (await db.query('SELECT * FROM repositories WHERE id=$1', [p.repo_id])).rows[0];
  const runId = id(),
    gen = t.generation + 1;
  const manifest = {
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
      architecture: 'arm64',
      checkout: '/workspace/repository',
      browserState: 'per-run',
      writeCredentials: false,
    },
    previousCandidate: t.candidate_id,
  };
  await db.query(
    "INSERT INTO runs(id,org_id,project_id,task_id,claim_id,generation,state,manifest) VALUES($1,$2,$3,$4,$5,$6,'queued',$7)",
    [runId, p.org_id, p.id, t.id, claimId, gen, JSON.stringify(manifest)],
  );
  await db.query(
    "UPDATE tasks SET state='building',generation=$2,candidate_id=NULL,version=version+1 WHERE id=$1",
    [t.id, gen],
  );
  await db.query(
    "INSERT INTO jobs(id,org_id,project_id,task_id,run_id,kind) VALUES($1,$2,$3,$4,$5,'execute')",
    [id(), p.org_id, p.id, t.id, runId],
  );
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
  p: any,
  t: any,
  input: Extract<Command, { action: 'start' }>,
) {
  requireThat(t.state === 'todo', 409, 'This task already has an implementation owner.');
  const deps = (
    await db.query(
      "SELECT t.title FROM dependencies d JOIN tasks t ON t.id=d.depends_on WHERE d.task_id=$1 AND t.state<>'completed'",
      [t.id],
    )
  ).rows;
  requireThat(!deps.length, 409, 'Complete the prerequisite tasks before starting this work.');
  const repo = (await db.query('SELECT * FROM repositories WHERE id=$1 FOR UPDATE', [p.repo_id]))
    .rows[0];
  const occupied = (
    await db.query('SELECT count(*)::int n FROM claims WHERE repo_id=$1 AND released_at IS NULL', [
      p.repo_id,
    ])
  ).rows[0].n;
  requireThat(
    occupied < repo.max_changes,
    409,
    'Another change is awaiting completion in this repository. Its review or merge must finish first.',
  );
  const claimId = id();
  await db.query(
    'INSERT INTO claims(id,org_id,project_id,task_id,owner_id,repo_id) VALUES($1,$2,$3,$4,$5,$6)',
    [claimId, p.org_id, p.id, t.id, actor.id, p.repo_id],
  );
  return queueRun(db, actor, p, t, claimId, input.minutes, input.budgetCents);
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
    const t = (
      await db.query('SELECT * FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE', [
        taskId,
        projectId,
      ])
    ).rows[0];
    requireThat(t, 404, 'Task not found.');
    requireThat(
      t.version === input.version,
      409,
      'This task has changed. Refresh and review the latest version.',
    );
    if (input.action === 'start') return startTask(db, actor, p, t, input);
    const claim = (
      await db.query('SELECT * FROM claims WHERE task_id=$1 AND released_at IS NULL', [taskId])
    ).rows[0];
    requireThat(claim, 409, 'This task has no active claim.');
    if (input.action === 'changes') {
      requireThat(
        t.state === 'review',
        409,
        'Corrections can start when this candidate is ready for review.',
      );
      requireThat(
        p.review || claim.owner_id === actor.id,
        403,
        'Only the owner or a designated reviewer can request a correction.',
      );
      requireThat(
        !(await db.query('SELECT 1 FROM runs WHERE claim_id=$1 AND stopped_at IS NULL', [claim.id]))
          .rowCount,
        409,
        'The previous execution has not been confirmed stopped.',
      );
      await db.query(
        'UPDATE approvals SET revoked_at=now() WHERE task_id=$1 AND consumed_at IS NULL',
        [taskId],
      );
      await db.query(
        'INSERT INTO comments(id,org_id,project_id,task_id,user_id,body) VALUES($1,$2,$3,$4,$5,$6)',
        [id(), p.org_id, projectId, taskId, actor.id, input.feedback],
      );
      await event(db, projectId, taskId, actor.id, 'Changes requested', {
        feedback: input.feedback,
      });
      const owner = (await db.query('SELECT id,kind FROM users WHERE id=$1', [claim.owner_id]))
        .rows[0];
      await access(db, owner, projectId, 'contribute');
      const previous = (
        await db.query(
          'SELECT manifest FROM runs WHERE claim_id=$1 ORDER BY generation DESC LIMIT 1',
          [claim.id],
        )
      ).rows[0].manifest;
      return queueRun(db, owner, p, t, claim.id, previous.minutes, previous.budgetCents);
    }
    requireThat(
      t.state === (input.action === 'publish' ? 'review' : 'code_review'),
      409,
      'This action is not available at this stage.',
    );
    const c = (
      await db.query('SELECT * FROM candidates WHERE id=$1 AND task_id=$2', [
        input.candidateId,
        taskId,
      ])
    ).rows[0];
    requireThat(
      c && c.id === t.candidate_id && c.generation === t.generation && c.digest === input.digest,
      409,
      'The candidate has changed. Review and approve the current snapshot.',
    );
    requireThat(
      c.evidence.checks.length > 0 && c.evidence.checks.every((x: any) => x.status === 'passed'),
      409,
      'Acceptance checks must pass before publication.',
    );
    if (input.action === 'merge')
      requireThat(
        (
          await db.query('SELECT 1 FROM publications WHERE task_id=$1 AND candidate_id=$2', [
            taskId,
            c.id,
          ])
        ).rowCount,
        409,
        'A verified pull request is required.',
      );
    const approvalId = id(),
      operationId = id();
    await db.query(
      "INSERT INTO approvals(id,org_id,project_id,task_id,candidate_id,action,digest,approver_id,policy_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'v1',now()+interval '30 minutes')",
      [approvalId, p.org_id, projectId, taskId, c.id, input.action, c.digest, actor.id],
    );
    await db.query(
      'INSERT INTO jobs(id,org_id,project_id,task_id,approval_id,kind) VALUES($1,$2,$3,$4,$5,$6)',
      [operationId, p.org_id, projectId, taskId, approvalId, input.action],
    );
    await db.query('UPDATE tasks SET state=$2,version=version+1 WHERE id=$1', [
      taskId,
      input.action === 'publish' ? 'publishing' : 'merging',
    ]);
    await event(
      db,
      projectId,
      taskId,
      actor.id,
      input.action === 'publish' ? 'Publication authorised' : 'Merge authorised',
      { candidateId: c.id, digest: c.digest, operationId },
    );
    return { id: taskId, approvalId, operationId };
  });
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
        (await db.query('SELECT 1 FROM tasks WHERE id=$1 AND project_id=$2', [taskId, projectId]))
          .rowCount,
        404,
        'Task not found.',
      );
    const commentId = id();
    await db.query('INSERT INTO comments VALUES($1,$2,$3,$4,$5,$6,now())', [
      commentId,
      p.org_id,
      projectId,
      taskId,
      actor.id,
      body,
    ]);
    await event(db, projectId, taskId, actor.id, 'Feedback added');
    return { id: commentId };
  });
}
export async function snapshot(actor: Actor, projectId: string) {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const project = await access(db, actor, projectId);
    const tasks = (
      await db.query(
        `SELECT t.*,u.name owner_name,c.owner_id,COALESCE(u.kind,'human') owner_kind,
   (SELECT row_to_json(r) FROM runs r WHERE r.task_id=t.id ORDER BY generation DESC LIMIT 1) run,
   (SELECT row_to_json(k) FROM candidates k WHERE k.id=t.candidate_id) candidate,
   (SELECT row_to_json(p) FROM publications p WHERE p.candidate_id=t.candidate_id LIMIT 1) publication
   FROM tasks t LEFT JOIN LATERAL (SELECT * FROM claims WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1) c ON true LEFT JOIN users u ON u.id=c.owner_id
   WHERE t.project_id=$1 ORDER BY t.created_at,t.id`,
        [projectId],
      )
    ).rows;
    const participants = (
      await db.query(
        "SELECT u.id,u.name,a.contribute,a.review,a.merge FROM project_access a JOIN users u ON u.id=a.user_id WHERE a.project_id=$1 AND u.kind='human' ORDER BY u.name",
        [projectId],
      )
    ).rows;
    const comments = (
      await db.query(
        'SELECT c.*,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=$1 ORDER BY c.created_at',
        [projectId],
      )
    ).rows;
    const events = (
      await db.query('SELECT * FROM events WHERE project_id=$1 ORDER BY id DESC LIMIT 100', [
        projectId,
      ])
    ).rows;
    return { project, tasks, participants, comments, events, cursor: events[0]?.id ?? '0' };
  });
}
export async function projects(actor: Actor) {
  const rows = await prisma.projects.findMany({
    where: { project_access: { some: { user_id: actor.id, memberships: { user_id: actor.id } } } },
    include: { organisations: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map(({ organisations, ...p }) => ({ ...p, org_name: organisations.name }));
}

/** Explicit, all-or-nothing batches. No background selection or authority beyond named tasks. */
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
      const t = (
        await db.query('SELECT * FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE', [
          selected.taskId,
          projectId,
        ])
      ).rows[0];
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
