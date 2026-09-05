import { applyTestMigrations } from '../scripts/migrations';
import { test, beforeAll, beforeEach, afterAll, expect } from 'bun:test';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
// Never use an operator's DATABASE_URL for tests. Only our private Unix-socket cluster.
delete process.env.DATABASE_URL;
const schema = 'test_' + randomUUID().replaceAll('-', '');
process.env.R2_TEST_SCHEMA = schema;
const { pool, prisma } = await import('@r2cloud/database');
const { command, createTask, snapshot, access, startBatch } = await import('@r2cloud/core/service');
const { executeOne, publishOne } = await import('@r2cloud/core/workflow');
const { issuePreview, readPreview } = await import('@r2cloud/core/preview');
const { FixtureExecution, FixturePublisher } = await import('@r2cloud/adapters/fixture');
const { createApp, createHttpServer } = await import('../apps/api/src/app');
const { createIdentity } = await import('../apps/api/src/auth');
const { hash } = await import('@r2cloud/contracts/hash');
const admin = new pg.Pool({ host: resolve('.local/pgsocket'), port: 55439, database: 'postgres' });
const maya = { id: 'maya', kind: 'human' as const },
  alex = { id: 'alex', kind: 'human' as const },
  sam = { id: 'sam', kind: 'human' as const },
  agent = { id: 'agent', kind: 'agent' as const };
const start = { action: 'start' as const, version: 1, minutes: 15, budgetCents: 300 };
const key = () => randomUUID();
async function task(tid = 'welcome') {
  return (await snapshot(maya, 'launch')).tasks.find((t) => t.id === tid)!;
}
async function review() {
  await command(maya, 'launch', 'welcome', key(), start);
  await executeOne(new FixtureExecution());
  return task();
}
async function approve(action: 'publish' | 'merge' = 'publish', actor = maya) {
  const t = await task();
  return command(actor, 'launch', t.id, key(), {
    action,
    version: t.version,
    candidateId: t.candidate.id,
    digest: t.candidate.digest,
  });
}
async function retryJobs() {
  await pool.query(
    "UPDATE jobs SET available_at=now(),lease_until=now()-interval '1 second' WHERE state IN ('uncertain','processing')",
  );
}
async function sessionCookie(userId = 'maya') {
  const token = key() + key();
  await prisma.sessions.create({
    data: { token_hash: hash(token), user_id: userId, expires_at: new Date(Date.now() + 60000) },
  });
  return `r2session=${token}`;
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const c = await admin.connect();
  try {
    await c.query(`SET search_path TO "${schema}"`);
    await applyTestMigrations(c);
  } finally {
    c.release();
  }
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE organisations,users,sessions,fixture_external,auth_users,auth_rate_limits RESTART IDENTITY CASCADE',
  );
  const seed = Bun.spawn([process.execPath, 'scripts/setup.ts'], {
    env: { ...process.env, R2_MODE: 'fixture', R2_TEST_SCHEMA: schema },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const status = await seed.exited;
  if (status) throw new Error(await new Response(seed.stderr).text());
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
test('12 concurrent starts produce exactly one owner, execution and durable job', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      command(i % 2 ? alex : maya, 'launch', 'welcome', key(), start),
    ),
  );
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect((await pool.query('SELECT * FROM claims WHERE released_at IS NULL')).rowCount).toBe(1);
  expect((await pool.query('SELECT * FROM runs WHERE stopped_at IS NULL')).rowCount).toBe(1);
  expect((await pool.query('SELECT * FROM jobs')).rowCount).toBe(1);
});
test('same-owner duplicate starts and idempotent retries cannot compete', async () => {
  const k = key();
  const first = await command(maya, 'launch', 'welcome', k, start);
  expect(await command(maya, 'launch', 'welcome', k, start)).toEqual(first);
  await expect(command(maya, 'launch', 'welcome', k, { ...start, minutes: 20 })).rejects.toThrow(
    'different content',
  );
  await expect(command(maya, 'launch', 'welcome', key(), { ...start, version: 2 })).rejects.toThrow(
    'owner',
  );
  expect((await pool.query('SELECT * FROM runs')).rowCount).toBe(1);
});
test('database constraints independently reject duplicate active claims and executions', async () => {
  await command(maya, 'launch', 'welcome', key(), start);
  await expect(
    pool.query(
      "INSERT INTO claims SELECT 'duplicate',org_id,project_id,task_id,owner_id,repo_id,NULL,now() FROM claims LIMIT 1",
    ),
  ).rejects.toThrow();
  await expect(
    pool.query(
      "INSERT INTO runs SELECT 'duplicate',org_id,project_id,task_id,claim_id,generation,'queued',NULL,NULL,NULL,manifest,now() FROM runs LIMIT 1",
    ),
  ).rejects.toThrow();
});
test('missing provider permission rolls back ownership, job, event and receipt', async () => {
  await pool.query("UPDATE provider_connections SET enabled=false WHERE user_id='maya'");
  await expect(command(maya, 'launch', 'welcome', key(), start)).rejects.toThrow('AI account');
  expect((await pool.query('SELECT * FROM claims')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM jobs')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM receipts')).rowCount).toBe(0);
  expect((await task()).state).toBe('todo');
});
test('cross-organisation, private-project and viewer writes are rejected', async () => {
  await expect(snapshot(maya, 'private')).rejects.toThrow('access');
  await expect(command(sam, 'launch', 'welcome', key(), start)).rejects.toThrow('permission');
  await expect(command(alex, 'ideas', 'welcome', key(), start)).rejects.toThrow('access');
  await expect(command(maya, 'ideas', 'welcome', key(), start)).rejects.toThrow('not found');
});
test('repository policy and dependencies reject conflicting work', async () => {
  await pool.query("INSERT INTO dependencies VALUES('studio','launch','pricing','welcome')");
  await expect(command(maya, 'launch', 'pricing', key(), start)).rejects.toThrow('prerequisite');
  await command(maya, 'launch', 'welcome', key(), start);
  await expect(command(maya, 'launch', 'mobile', key(), start)).rejects.toThrow('repository');
});
test('repository concurrency is a configurable policy, organisation limits still apply', async () => {
  await pool.query("UPDATE repositories SET max_changes=3 WHERE id='website'");
  await command(maya, 'launch', 'welcome', key(), start);
  await command(alex, 'launch', 'mobile', key(), start);
  await expect(command(maya, 'launch', 'contact', key(), start)).rejects.toThrow(
    'concurrent run limit',
  );
});
test('awaiting review retains ownership; turn end does not complete a task', async () => {
  const t = await review();
  expect(t.state).toBe('review');
  expect(t.owner_id).toBe('maya');
  expect(t.run.state).toBe('stopped');
  expect((await pool.query('SELECT * FROM claims WHERE released_at IS NULL')).rowCount).toBe(1);
  await expect(
    pool.query("UPDATE tasks SET state='completed' WHERE id='welcome'"),
  ).rejects.toThrow();
});
test('a disconnected runner is never replaced just because a job lease expires', async () => {
  await command(maya, 'launch', 'welcome', key(), start);
  let starts = 0;
  await executeOne({
    mode: 'fixture',
    observe: async () => ({ state: 'unknown' }),
    start: async () => {
      starts++;
      throw Error('must not execute');
    },
  });
  await retryJobs();
  await executeOne({
    mode: 'fixture',
    observe: async () => ({ state: 'running' }),
    start: async () => {
      starts++;
      throw Error('must not execute');
    },
  });
  expect(starts).toBe(0);
  expect((await task()).state).toBe('blocked');
  expect((await pool.query('SELECT * FROM runs WHERE stopped_at IS NULL')).rowCount).toBe(1);
});
test('lost execution response reconciles durable result without a second run', async () => {
  class LostResponse extends FixtureExecution {
    override async start(g: any): Promise<never> {
      await super.start(g);
      throw Error('Response lost after sandbox stopped');
    }
  }
  await command(maya, 'launch', 'welcome', key(), start);
  await executeOne(new LostResponse());
  expect((await task()).state).toBe('blocked');
  await retryJobs();
  await executeOne(new FixtureExecution());
  expect((await task()).state).toBe('review');
  expect((await pool.query('SELECT * FROM fixture_external')).rowCount).toBe(1);
});
test('old execution generation cannot attach a candidate', async () => {
  await command(maya, 'launch', 'welcome', key(), start);
  class StaleResult extends FixtureExecution {
    override async start(g: any) {
      const r = await super.start(g);
      r.manifest.generation--;
      return r;
    }
  }
  await executeOne(new StaleResult());
  expect((await pool.query('SELECT * FROM candidates')).rowCount).toBe(0);
  expect((await task()).state).toBe('blocked');
});
test('correction produces a new snapshot and old candidate approval is rejected', async () => {
  const old = await review();
  await command(maya, 'launch', 'welcome', key(), {
    action: 'changes',
    version: old.version,
    feedback: 'Use a clearer call to action.',
  });
  await executeOne(new FixtureExecution());
  const next = await task();
  expect(next.generation).toBe(2);
  expect(next.candidate.digest).not.toBe(old.candidate.digest);
  await expect(
    command(maya, 'launch', 'welcome', key(), {
      action: 'publish',
      version: next.version,
      candidateId: old.candidate.id,
      digest: old.candidate.digest,
    }),
  ).rejects.toThrow('candidate has changed');
  await expect(
    pool.query("UPDATE candidates SET manifest='{}' WHERE id=$1", [next.candidate.id]),
  ).rejects.toThrow('immutable');
  expect((await pool.query('SELECT * FROM claims')).rowCount).toBe(1);
});
test('contributors and agents cannot approve publication or merge', async () => {
  await review();
  await expect(approve('publish', alex)).rejects.toThrow('permission');
  await pool.query("UPDATE project_access SET review=true,merge=true WHERE user_id='agent'");
  const t = await task();
  await expect(
    command(agent, 'launch', 'welcome', key(), {
      action: 'publish',
      version: t.version,
      candidateId: t.candidate.id,
      digest: t.candidate.digest,
    }),
  ).rejects.toThrow('person');
  await approve();
  await publishOne(new FixturePublisher());
  await expect(approve('merge', alex)).rejects.toThrow('permission');
});
test('revoked or expired approvals do not allow a new external write', async () => {
  await review();
  await approve();
  await pool.query("UPDATE approvals SET expires_at=now()-interval '1 second'");
  let writes = 0;
  class Publisher extends FixturePublisher {
    override async publish(g: any) {
      writes++;
      return super.publish(g);
    }
  }
  await publishOne(new Publisher());
  expect(writes).toBe(0);
  expect((await task()).state).toBe('blocked');
});
test('revoked reviewer membership is checked by the publisher', async () => {
  await review();
  await approve();
  await pool.query("UPDATE project_access SET review=false WHERE user_id='maya'");
  await publishOne(new FixturePublisher());
  expect((await pool.query("SELECT * FROM fixture_external WHERE kind='publish'")).rowCount).toBe(
    0,
  );
});
test('uncertain publication reconciles after approval expiry without duplicate PR', async () => {
  await review();
  await approve();
  class LostResponse extends FixturePublisher {
    override async publish(g: any): Promise<never> {
      await super.publish(g);
      throw Error('GitHub timed out after creating PR');
    }
  }
  await publishOne(new LostResponse());
  expect((await task()).state).toBe('blocked');
  await pool.query("UPDATE approvals SET expires_at=now()-interval '1 second'");
  await retryJobs();
  await publishOne(new FixturePublisher());
  expect((await task()).state).toBe('code_review');
  expect((await pool.query("SELECT * FROM fixture_external WHERE kind='publish'")).rowCount).toBe(
    1,
  );
});
test('a stale generation cannot publish and fixtures cannot reach a real publisher', async () => {
  await review();
  await approve();
  await pool.query("UPDATE tasks SET generation=generation+1 WHERE id='welcome'");
  await publishOne(new FixturePublisher());
  expect((await pool.query('SELECT * FROM publications')).rowCount).toBe(0);
});
test('merge response without verified merge facts never completes the task', async () => {
  await review();
  await approve();
  await publishOne(new FixturePublisher());
  expect((await task()).state).toBe('code_review');
  await approve('merge');
  class NotMerged extends FixturePublisher {
    override async merge(g: any) {
      return { ...(await super.merge(g)), merged: false, mergeSha: null };
    }
  }
  await publishOne(new NotMerged());
  expect((await task()).state).toBe('blocked');
  expect((await task()).completed_at).toBeNull();
});
test('private previews enforce expiry and current project membership', async () => {
  const t = await review();
  await expect(
    issuePreview({ id: 'outsider', kind: 'human' }, 'launch', t.candidate.id),
  ).rejects.toThrow('access');
  const grant = await issuePreview(sam, 'launch', t.candidate.id);
  const token = grant.url.split('#')[1];
  expect((await readPreview(token)).manifest.fixture).toBe(true);
  await pool.query("DELETE FROM project_access WHERE project_id='launch' AND user_id='sam'");
  await expect(readPreview(token)).rejects.toThrow('access');
  const other = await issuePreview(maya, 'launch', t.candidate.id);
  await pool.query("UPDATE preview_grants SET expires_at=now()-interval '1 second'");
  await expect(readPreview(other.url.split('#')[1])).rejects.toThrow('expired');
});
test('API validates sessions, CSRF origin, schemas, and durable command keys', async () => {
  const app = createApp({ fixture: true });
  await request(app).get('/api/me').expect(401);
  const cookie = await sessionCookie();
  await request(app)
    .post('/api/projects/launch/tasks')
    .set('Cookie', cookie)
    .set('Origin', 'https://attacker.invalid')
    .send({})
    .expect(403);
  await request(app)
    .post('/api/projects/launch/tasks')
    .set('Cookie', cookie)
    .send({ title: 'x' })
    .expect(400);
  await request(app).get('/api/projects/private/snapshot').set('Cookie', cookie).expect(403);
  await request(createApp({ fixture: false }))
    .post('/api/local-session')
    .send({ userId: 'maya' })
    .expect(401);
  const input = {
    title: 'A clearer welcome',
    outcome: 'Make it easy to begin',
    criteria: ['One visible next step'],
    priority: 'High',
  };
  const k = key();
  const first = await request(app)
    .post('/api/projects/launch/tasks')
    .set('Cookie', cookie)
    .set('Idempotency-Key', k)
    .send(input)
    .expect(201);
  const repeated = await request(app)
    .post('/api/projects/launch/tasks')
    .set('Cookie', cookie)
    .set('Idempotency-Key', k)
    .send(input)
    .expect(201);
  expect(repeated.body).toEqual(first.body);
});
test('Socket.IO reconnection takes a fresh authoritative snapshot; closing it retains ownership', async () => {
  const { server, io } = createHttpServer({ fixture: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  const cookie = await sessionCookie();
  const connect = () =>
    connectSocket(`http://127.0.0.1:${addr.port}`, {
      auth: { projectId: 'launch' },
      extraHeaders: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
  let socket = connect();
  await new Promise<void>((r, j) => {
    socket.once('snapshot-required', () => r());
    socket.once('connect_error', j);
  });
  socket.disconnect();
  await command(maya, 'launch', 'welcome', key(), start);
  socket = connect();
  const cursor = await new Promise<string>((r, j) => {
    socket.once('snapshot-required', (x) => r(x.cursor));
    socket.once('connect_error', j);
  });
  expect(BigInt(cursor) > 0n).toBe(true);
  expect((await task()).owner_id).toBe('maya');
  socket.disconnect();
  expect((await pool.query('SELECT * FROM claims WHERE released_at IS NULL')).rowCount).toBe(1);
  await new Promise<void>((r) => io.close(() => r()));
});
test('full fixture journey: create, start, review, correction, publication, separate verified merge', async () => {
  const app = createApp({ fixture: true }),
    cookie = await sessionCookie();
  const created = await request(app)
    .post('/api/projects/launch/tasks')
    .set('Cookie', cookie)
    .set('Idempotency-Key', key())
    .send({
      title: 'A welcome that helps visitors',
      outcome: 'Visitors know what to do next',
      criteria: ['Clear next step', 'Works on mobile'],
      priority: 'High',
    })
    .expect(201);
  const tid = created.body.id;
  const send = async (payload: any) =>
    request(app)
      .post(`/api/projects/launch/tasks/${tid}/commands`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', key())
      .send(payload)
      .expect(200);
  await send(start);
  await executeOne(new FixtureExecution());
  let t = await task(tid);
  expect(t.state).toBe('review');
  await send({
    action: 'changes',
    version: t.version,
    feedback: 'Make the primary action more specific.',
  });
  await executeOne(new FixtureExecution());
  t = await task(tid);
  await send({
    action: 'publish',
    version: t.version,
    candidateId: t.candidate.id,
    digest: t.candidate.digest,
  });
  await publishOne(new FixturePublisher());
  t = await task(tid);
  expect(t.state).toBe('code_review');
  expect(t.completed_at).toBeNull();
  await send({
    action: 'merge',
    version: t.version,
    candidateId: t.candidate.id,
    digest: t.candidate.digest,
  });
  await publishOne(new FixturePublisher());
  t = await task(tid);
  expect(t.state).toBe('completed');
  expect(t.completed_at).not.toBeNull();
  expect(t.owner_id).toBe('maya');
  expect((await pool.query('SELECT * FROM claims WHERE released_at IS NULL')).rowCount).toBe(0);
});

const batch = {
  tasks: [
    { taskId: 'welcome', version: 1 },
    { taskId: 'pricing', version: 1 },
  ],
  minutesPerTask: 15,
  budgetCentsPerTask: 300,
  maxTotalBudgetCents: 600,
};
test('explicit batches are atomic, budgeted and idempotent', async () => {
  await pool.query("UPDATE repositories SET max_changes=2 WHERE id='website'");
  const k = key();
  const first = await startBatch(maya, 'launch', k, batch);
  expect(first.tasks).toHaveLength(2);
  expect(await startBatch(maya, 'launch', k, batch)).toEqual(first);
  expect((await pool.query('SELECT * FROM runs')).rowCount).toBe(2);
  expect((await pool.query('SELECT * FROM claims')).rowCount).toBe(2);
  expect((await pool.query('SELECT * FROM jobs')).rowCount).toBe(2);
  expect((await task('mobile')).state).toBe('todo');
  await expect(startBatch(maya, 'launch', k, { ...batch, minutesPerTask: 20 })).rejects.toThrow(
    'different content',
  );
});
test('failed batch validation and concurrency leave no partial claims or jobs', async () => {
  await expect(startBatch(maya, 'launch', key(), batch)).rejects.toThrow('repository');
  await pool.query("UPDATE repositories SET max_changes=3 WHERE id='website'");
  await expect(
    startBatch(maya, 'launch', key(), { ...batch, maxTotalBudgetCents: 500 }),
  ).rejects.toThrow('budget');
  await expect(
    startBatch(maya, 'launch', key(), {
      ...batch,
      tasks: [...batch.tasks, { taskId: 'mobile', version: 1 }],
      maxTotalBudgetCents: 900,
    }),
  ).rejects.toThrow('concurrent run limit');
  await expect(
    startBatch(maya, 'launch', key(), {
      ...batch,
      tasks: [...batch.tasks, { taskId: 'private-task', version: 1 }],
      maxTotalBudgetCents: 900,
    }),
  ).rejects.toThrow('does not belong');
  await expect(startBatch(sam, 'launch', key(), batch)).rejects.toThrow('permission');
  expect((await pool.query('SELECT * FROM claims')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM runs')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM jobs')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM receipts')).rowCount).toBe(0);
});
test('approval actor type comes from authoritative identity, not caller metadata', async () => {
  await review();
  await pool.query("UPDATE project_access SET review=true,merge=true WHERE user_id='agent'");
  await expect(approve('publish', { id: 'agent', kind: 'human' })).rejects.toThrow('person');
});
test('uncertain execution retries stop at a bounded limit and preserve ownership', async () => {
  await command(maya, 'launch', 'welcome', key(), start);
  let observations = 0;
  const provider = {
    mode: 'fixture' as const,
    observe: async () => {
      observations++;
      return { state: 'unknown' as const };
    },
    start: async () => {
      throw Error('must never replace');
    },
  };
  for (let i = 0; i < 7; i++) {
    await retryJobs();
    await executeOne(provider);
  }
  expect(observations).toBe(5);
  expect((await pool.query('SELECT state FROM jobs')).rows[0].state).toBe('blocked');
  expect((await pool.query('SELECT * FROM claims WHERE released_at IS NULL')).rowCount).toBe(1);
  expect((await pool.query('SELECT * FROM runs WHERE stopped_at IS NULL')).rowCount).toBe(1);
});

test('a superseded generation failure cannot block or version the current task', async () => {
  await command(maya, 'launch', 'welcome', key(), start);
  await pool.query("UPDATE tasks SET generation=generation+1,version=version+1 WHERE id='welcome'");
  const before = await task();
  await executeOne(new FixtureExecution());
  const after = await task();
  expect(after.state).toBe(before.state);
  expect(after.version).toBe(before.version);
  expect((await pool.query('SELECT * FROM candidates')).rowCount).toBe(0);
  expect((await pool.query('SELECT state FROM jobs')).rows[0].state).toBe('blocked');
});

const authOrigin = 'http://127.0.0.1:5173';
const { mockGitHub } = await import('./github-provider');
function identityApp() {
  const { identity, auth } = createIdentity({
    baseURL: authOrigin,
    secret: 'test-only-' + key() + key(),
    githubClientId: 'test-client',
    githubClientSecret: 'test-client-secret',
  });
  return { identity, auth, app: createApp({ fixture: true, identity }) };
}
const cookies = (response: any) =>
  (response.headers['set-cookie'] ?? []).map((c: string) => c.split(';')[0]).join('; ');
async function githubAccount(
  app: ReturnType<typeof createApp>,
  provider: ReturnType<typeof mockGitHub>,
  input: { verified?: boolean; id?: string; email?: string } = {},
) {
  const begin = await request(app)
    .post('/api/auth/sign-in/social')
    .set('Origin', authOrigin)
    .send({ provider: 'github', callbackURL: authOrigin, disableRedirect: true })
    .expect(200);
  const authorization = new URL(begin.body.url);
  expect(authorization.origin).toBe('https://github.com');
  expect(new Set(authorization.searchParams.get('scope')!.split(' '))).toEqual(
    new Set(['read:user', 'user:email']),
  );
  const state = authorization.searchParams.get('state');
  const code = provider.issue(input);
  const callback = await request(app)
    .get(`/api/auth/callback/github?code=${code}&state=${state}`)
    .set('Cookie', cookies(begin))
    .expect(302);
  const cookie = cookies(callback);
  const session = await request(app).get('/api/auth/get-session').set('Cookie', cookie).expect(200);
  return { cookie, user: session.body?.user, code, state, stateCookie: cookies(begin) };
}
test('GitHub OAuth maps a verified identity without implicit project or provider access', async () => {
  const provider = mockGitHub();
  try {
    const { app } = identityApp();
    const account = await githubAccount(app, provider);
    const me = await request(app).get('/api/me').set('Cookie', account.cookie).expect(200);
    expect(me.body.user.id).toBe('person:' + account.user.id);
    expect(me.body.user.kind).toBe('human');
    expect(me.body.projects).toEqual([]);
    expect(me.body.authMode).toBe('better-auth');
    await request(app)
      .get('/api/projects/launch/snapshot')
      .set('Cookie', account.cookie)
      .expect(403);
    const stored = await prisma.authAccount.findFirstOrThrow({
      where: { userId: account.user.id },
    });
    expect(stored.providerId).toBe('github');
    expect(stored.password).toBeNull();
    expect(stored.accessToken).not.toContain('fixture-identity-token');
    expect(
      (await pool.query('SELECT * FROM provider_connections WHERE user_id=$1', [me.body.user.id]))
        .rowCount,
    ).toBe(0);
    expect(provider.calls).toBe(3);
  } finally {
    provider.restore();
  }
});
test('GitHub login cannot request repository scopes or accept foreign origins and fixture cookies', async () => {
  const { app } = identityApp();
  await request(app)
    .post('/api/auth/sign-in/social')
    .set('Origin', authOrigin)
    .send({ provider: 'github', scopes: ['repo'] })
    .expect(400);
  await request(app)
    .post('/api/auth/sign-in/social')
    .set('Origin', 'https://attacker.test')
    .send({ provider: 'github' })
    .expect(403);
  await request(app)
    .post('/api/auth/sign-in/social')
    .set('Origin', authOrigin)
    .send({ provider: 'google' })
    .expect(400);
  await request(app)
    .get('/api/me')
    .set('Cookie', await sessionCookie())
    .expect(401);
  await request(app)
    .post('/api/local-session')
    .set('Origin', authOrigin)
    .send({ userId: 'maya' })
    .expect(401);
  const email = await request(app).post('/api/auth/sign-up/email').set('Origin', authOrigin).send({
    name: 'No email login',
    email: 'blocked@example.test',
    password: 'test-only-long-password',
  });
  expect(email.status).toBeGreaterThanOrEqual(400);
});
test('unverified GitHub email cannot enter the product or create a workspace', async () => {
  const provider = mockGitHub();
  try {
    const { app } = identityApp();
    const account = await githubAccount(app, provider, { verified: false });
    await request(app).get('/api/me').set('Cookie', account.cookie).expect(401);
    await request(app)
      .post('/api/workspaces')
      .set('Origin', authOrigin)
      .set('Cookie', account.cookie)
      .set('Idempotency-Key', key())
      .send({ name: 'Blocked team', projectName: 'Blocked project' })
      .expect(401);
  } finally {
    provider.restore();
  }
});
test('OAuth state is browser-bound and one-use; invalid callbacks do not call GitHub', async () => {
  const provider = mockGitHub();
  try {
    const { app } = identityApp();
    const invalid = await request(app).get('/api/auth/callback/github?state=forged&code=forged');
    expect([302, 400]).toContain(invalid.status);
    expect(provider.calls).toBe(0);
    const begin = await request(app)
      .post('/api/auth/sign-in/social')
      .set('Origin', authOrigin)
      .send({ provider: 'github', callbackURL: authOrigin, disableRedirect: true })
      .expect(200);
    const state = new URL(begin.body.url).searchParams.get('state');
    const unbound = await request(app).get(
      `/api/auth/callback/github?state=${state}&code=${provider.issue()}`,
    );
    expect([302, 400]).toContain(unbound.status);
    expect(provider.calls).toBe(0);
    expect(await prisma.authSession.count()).toBe(0);
    const account = await githubAccount(app, provider);
    const replay = await request(app)
      .get(`/api/auth/callback/github?state=${account.state}&code=${account.code}`)
      .set('Cookie', account.stateCookie);
    expect([302, 400]).toContain(replay.status);
    expect(provider.calls).toBe(3);
    expect(await prisma.authSession.count()).toBe(1);
  } finally {
    provider.restore();
  }
});
test('sign-out revokes the database session immediately', async () => {
  const provider = mockGitHub();
  try {
    const { app } = identityApp();
    const account = await githubAccount(app, provider);
    await request(app).get('/api/me').set('Cookie', account.cookie).expect(200);
    await request(app)
      .post('/api/logout')
      .set('Origin', authOrigin)
      .set('Cookie', account.cookie)
      .send({})
      .expect(200);
    await request(app).get('/api/me').set('Cookie', account.cookie).expect(401);
  } finally {
    provider.restore();
  }
});
test('first workspace setup is atomic and isolated, with no repository attached', async () => {
  const provider = mockGitHub();
  try {
    const { app } = identityApp();
    const account = await githubAccount(app, provider);
    const k = key();
    const create = () =>
      request(app)
        .post('/api/workspaces')
        .set('Origin', authOrigin)
        .set('Cookie', account.cookie)
        .set('Idempotency-Key', k)
        .send({ name: 'A new team', projectName: 'First product' });
    const [one, two] = await Promise.all([create(), create()]);
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(one.body).toEqual(two.body);
    const me = await request(app).get('/api/me').set('Cookie', account.cookie).expect(200);
    expect(me.body.projects).toHaveLength(1);
    expect(me.body.projects[0].id).toBe(one.body.projectId);
    const board = await request(app)
      .get(`/api/projects/${one.body.projectId}/snapshot`)
      .set('Cookie', account.cookie)
      .expect(200);
    expect(board.body.tasks).toHaveLength(0);
    expect(board.body.project.review).toBe(true);
    const created = await request(app)
      .post(`/api/projects/${one.body.projectId}/tasks`)
      .set('Origin', authOrigin)
      .set('Cookie', account.cookie)
      .set('Idempotency-Key', key())
      .send({
        title: 'A real outcome',
        outcome: 'Visitors understand the product',
        criteria: ['One clear next step'],
        priority: 'High',
      })
      .expect(201);
    const blocked = await request(app)
      .post(`/api/projects/${one.body.projectId}/tasks/${created.body.id}/commands`)
      .set('Origin', authOrigin)
      .set('Cookie', account.cookie)
      .set('Idempotency-Key', key())
      .send(start)
      .expect(409);
    expect(blocked.body.error).toContain('Connect a repository');
    const outsider = await githubAccount(app, provider);
    await request(app)
      .get(`/api/projects/${one.body.projectId}/snapshot`)
      .set('Cookie', outsider.cookie)
      .expect(403);
  } finally {
    provider.restore();
  }
});
test('session revocation disconnects Socket.IO while task ownership survives', async () => {
  const provider = mockGitHub();
  let cleanup = async () => {};
  try {
    const { identity, app } = identityApp();
    const account = await githubAccount(app, provider);
    const actor = (await request(app).get('/api/me').set('Cookie', account.cookie)).body.user;
    await pool.query("INSERT INTO memberships(org_id,user_id) VALUES('studio',$1)", [actor.id]);
    await pool.query(
      "INSERT INTO project_access(org_id,project_id,user_id,contribute,review,merge) VALUES('studio','launch',$1,true,false,false)",
      [actor.id],
    );
    await command(maya, 'launch', 'welcome', key(), start);
    const { server, io } = createHttpServer({ fixture: true, identity });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const socket = connectSocket(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      {
        auth: { projectId: 'launch' },
        transports: ['websocket'],
        extraHeaders: { Cookie: account.cookie, Origin: authOrigin },
        forceNew: true,
        reconnection: false,
      },
    );
    cleanup = async () => {
      socket.disconnect();
      await new Promise<void>((r) => io.close(() => r()));
    };
    await new Promise<void>((r, j) => {
      socket.once('snapshot-required', () => r());
      socket.once('connect_error', j);
    });
    const ended = new Promise<void>((r) => socket.once('access-ended', () => r()));
    await prisma.authSession.deleteMany({ where: { userId: account.user.id } });
    await ended;
    expect((await task()).owner_id).toBe('maya');
  } finally {
    await cleanup();
    provider.restore();
  }
});
test('missing OAuth configuration fails closed and login attempts are rate limited in Postgres', async () => {
  expect(() =>
    createIdentity({
      baseURL: authOrigin,
      secret: key() + key(),
      githubClientId: '',
      githubClientSecret: '',
    }),
  ).toThrow('GitHub');
  const { app } = identityApp();
  const statuses = [];
  for (let i = 0; i < 11; i++)
    statuses.push(
      (
        await request(app)
          .post('/api/auth/sign-in/social')
          .set('Origin', authOrigin)
          .set('X-Forwarded-For', `192.0.2.${i}`)
          .set('X-R2-Client-IP', `192.0.2.${i}`)
          .send({ provider: 'github', disableRedirect: true })
      ).status,
    );
  expect(statuses.at(-1)).toBe(429);
  expect(await prisma.authRateLimit.count()).toBeGreaterThan(0);
});

test('product API rejects legacy fixture cookies and exposes no demo session endpoint', async () => {
  const token = key();
  await pool.query("INSERT INTO sessions VALUES($1,'maya',now()+interval '1 hour')", [hash(token)]);
  const app = createApp({ fixture: false });
  await request(app).get('/api/me').set('Cookie', `r2session=${token}`).expect(401);
  await request(app).post('/api/local-session').send({ userId: 'maya' }).expect(401);
  const config = await request(app).get('/api/auth-config').expect(200);
  expect(config.body).toEqual({ mode: 'unconfigured', provider: 'github', enabled: false });
});
test('workspace owners create empty projects idempotently; members and other organisations cannot', async () => {
  const { createProject } = await import('@r2cloud/core/projects');
  await pool.query("UPDATE memberships SET role='owner' WHERE user_id='maya' AND org_id='studio'");
  const receipt = key();
  const values = await Promise.all([
    createProject(maya, 'studio', receipt, { name: 'Customer portal' }),
    createProject(maya, 'studio', receipt, { name: 'Customer portal' }),
  ]);
  expect(values[0]).toEqual(values[1]);
  const board = await snapshot(maya, values[0].projectId);
  expect(board.tasks).toHaveLength(0);
  expect(board.project.repo_id).toBeNull();
  expect(board.project.review).toBe(true);
  await expect(createProject(alex, 'studio', key(), { name: 'Hidden access' })).rejects.toThrow(
    'administrator',
  );
  await expect(createProject(maya, 'other', key(), { name: 'Hidden access' })).rejects.toThrow(
    'administrator',
  );
  await expect(createProject(maya, 'studio', receipt, { name: 'Changed payload' })).rejects.toThrow(
    'different content',
  );
});

test('Vercel allocation and commands use durable intents, explicit credentials and restricted defaults', async () => {
  const { VercelSandboxes } = await import('@r2cloud/adapters/vercel');
  const { PostgresSandboxJournal } = await import('@r2cloud/core/sandbox-journal');
  await command(maya, 'launch', 'welcome', key(), start);
  const job = (await pool.query("SELECT * FROM jobs WHERE task_id='welcome'")).rows[0];
  await pool.query(
    `UPDATE runs SET manifest=jsonb_set(manifest,'{mode}','"managed"') WHERE id=$1`,
    [job.run_id],
  );
  const identity = { operationId: job.id, runId: job.run_id, generation: 1 };
  const journal = new PostgresSandboxJournal();
  let created: any;
  let runs = 0;
  let stopCalls = 0;
  const session = {
    runCommand: async (params: any) => {
      runs++;
      expect(params.env).toEqual({});
      expect(params.timeoutMs).toBe(60000);
      return { exitCode: 0 };
    },
  };
  const sandbox: any = {
    name: '',
    status: 'running',
    tags: {},
    currentSession: () => session,
    stop: async () => {
      stopCalls++;
      return { status: 'stopped' };
    },
  };
  const sdk: any = {
    create: async (params: any) => {
      created = params;
      sandbox.name = params.name;
      sandbox.tags = params.tags;
      return sandbox;
    },
    get: async (params: any) => {
      expect(params.resume).toBe(false);
      return sandbox;
    },
  };
  const cloud = new VercelSandboxes(
    { token: 'test-token', projectId: 'test-project', teamId: 'test-team' },
    journal,
    sdk,
  );
  const plan = {
    image: 'r2/base@sha256:' + 'a'.repeat(64),
    region: 'iad1' as const,
    minutes: 15,
    vcpus: 2 as const,
  };
  await cloud.ensure(identity, plan);
  await cloud.ensure(identity, plan);
  expect(created.networkPolicy).toBe('deny-all');
  expect(created.env).toEqual({});
  expect(created.ports).toEqual([]);
  expect(created.persistent).toBe(false);
  expect(created.source).toBeUndefined();
  const cmd = { cmd: 'bun', args: ['test'], cwd: '/vercel/sandbox/repository' };
  await cloud.command(identity, 'tests', cmd);
  await cloud.command(identity, 'tests', cmd);
  expect(runs).toBe(1);
  await expect(
    cloud.command(identity, 'tests', { ...cmd, args: ['run', 'build'] }),
  ).rejects.toThrow('different content');
  await expect(cloud.ensure(identity, { ...plan, vcpus: 4 })).rejects.toThrow('different');
  const proof = await cloud.stop(identity);
  expect(proof).toHaveLength(64);
  await cloud.stop(identity);
  expect(stopCalls).toBe(1);
  await expect(cloud.command(identity, 'later', cmd)).rejects.toThrow('not reserved');
  expect((await cloud.observe(identity)).state).toBe('stopped');
});
test('uncertain Vercel creation never creates a replacement and stale generations are rejected', async () => {
  const { VercelSandboxes } = await import('@r2cloud/adapters/vercel');
  const { PostgresSandboxJournal } = await import('@r2cloud/core/sandbox-journal');
  await command(maya, 'launch', 'welcome', key(), start);
  const job = (await pool.query("SELECT * FROM jobs WHERE task_id='welcome'")).rows[0];
  await pool.query(
    `UPDATE runs SET manifest=jsonb_set(manifest,'{mode}','"managed"') WHERE id=$1`,
    [job.run_id],
  );
  const identity = { operationId: job.id, runId: job.run_id, generation: 1 };
  let creates = 0;
  const sdk: any = {
    create: async () => {
      creates++;
      throw new Error('Timeout after allocation');
    },
    get: async () => {
      throw new Error('Network unavailable');
    },
  };
  const cloud = new VercelSandboxes(
    { token: 'test', projectId: 'test', teamId: 'test' },
    new PostgresSandboxJournal(),
    sdk,
  );
  const plan = {
    image: 'r2/base@sha256:' + 'a'.repeat(64),
    region: 'iad1' as const,
    minutes: 15,
    vcpus: 2 as const,
  };
  await expect(cloud.ensure(identity, plan)).rejects.toThrow('uncertain');
  await expect(cloud.ensure(identity, plan)).rejects.toThrow('replacement');
  expect(creates).toBe(1);
  expect((await cloud.observe(identity)).state).toBe('unknown');
  await expect(cloud.ensure({ ...identity, generation: 2 }, plan)).rejects.toThrow('Stale');
});

test('a lost Vercel command response is not replayed; stop can be reconciled after a timeout', async () => {
  const { VercelSandboxes } = await import('@r2cloud/adapters/vercel');
  const { PostgresSandboxJournal } = await import('@r2cloud/core/sandbox-journal');
  await command(maya, 'launch', 'welcome', key(), start);
  const job = (await pool.query("SELECT * FROM jobs WHERE task_id='welcome'")).rows[0];
  await pool.query(
    `UPDATE runs SET manifest=jsonb_set(manifest,'{mode}','"managed"') WHERE id=$1`,
    [job.run_id],
  );
  const identity = { operationId: job.id, runId: job.run_id, generation: 1 };
  let commands = 0,
    stops = 0;
  const sandbox: any = {
    name: '',
    status: 'running',
    tags: {},
    currentSession: () => ({
      runCommand: async () => {
        commands++;
        throw new Error('Lost response');
      },
    }),
    stop: async () => {
      stops++;
      if (stops === 1) throw new Error('Lost stop');
      return { status: 'stopped' };
    },
  };
  const sdk: any = {
    create: async (p: any) => {
      sandbox.name = p.name;
      sandbox.tags = p.tags;
      return sandbox;
    },
    get: async () => sandbox,
  };
  const cloud = new VercelSandboxes(
    { token: 'test', teamId: 'test', projectId: 'test' },
    new PostgresSandboxJournal(),
    sdk,
  );
  await cloud.ensure(identity, {
    image: 'r2/base@sha256:' + 'a'.repeat(64),
    region: 'iad1',
    minutes: 15,
    vcpus: 2,
  });
  const step = { cmd: 'bun', args: ['test'], cwd: '/vercel/sandbox/repository' };
  await expect(cloud.command(identity, 'run', step)).rejects.toThrow('Lost response');
  await expect(cloud.command(identity, 'run', step)).rejects.toThrow('must not be replayed');
  expect(commands).toBe(1);
  await expect(cloud.stop(identity)).rejects.toThrow('not confirmed');
  await expect(cloud.command(identity, 'another', step)).rejects.toThrow('not reserved');
  expect(await cloud.stop(identity)).toHaveLength(64);
  expect(stops).toBe(2);
});
