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
const { command, createTask, snapshot, access } = await import('@r2cloud/core/service');
const { executeOne, publishOne } = await import('@r2cloud/core/workflow');
const { issuePreview, readPreview } = await import('@r2cloud/core/preview');
const { FixtureExecution, FixturePublisher } = await import('@r2cloud/adapters/fixture');
const { createApp, createHttpServer } = await import('../apps/api/src/app');
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
    await c.query(
      await readFile(
        'packages/database/prisma/migrations/202609050001_initial/migration.sql',
        'utf8',
      ),
    );
  } finally {
    c.release();
  }
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE organisations,users,sessions,fixture_external RESTART IDENTITY CASCADE',
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
  const app = createApp({ fixture: false });
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
  await request(app).post('/api/local-session').send({ userId: 'maya' }).expect(401);
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
  const { server, io } = createHttpServer({ fixture: false });
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
  const app = createApp({ fixture: false }),
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
  expect((await pool.query('SELECT * FROM claims WHERE released_at IS NULL')).rowCount).toBe(0);
});
