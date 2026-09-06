import { prisma, json, type DB, type jobs } from '@r2cloud/database';
import { lockRow, nextJob } from '@r2cloud/database/locking';
import { access, event, lockProject } from './project-context';
import { digest, id } from '@r2cloud/contracts/hash';
import { Fault, requireThat, type CandidateManifest } from '@r2cloud/contracts/domain';
import {
  SetupRequired,
  Uncertain,
  type ExecutionBackend,
  type PublisherBackend,
  type RunGrant,
  type RunResult,
  type PublicationGrant,
  type PublicationResult,
  type MergeResult,
} from '@r2cloud/contracts/adapters';
async function reserve(kinds: string[]) {
  return prisma.$transaction(async (db) => {
    const jobId = await nextJob(db, kinds);
    if (!jobId) return null;
    return db.jobs.update({
      where: { id: jobId },
      data: {
        state: 'processing',
        attempts: { increment: 1 },
        lease_token: id(),
        lease_until: new Date(Date.now() + 90_000),
      },
    });
  });
}
async function assertJob(db: DB, job: jobs) {
  await lockRow(db, 'jobs', job.id);
  requireThat(
    await db.jobs.count({
      where: { id: job.id, lease_token: job.lease_token, state: 'processing' },
    }),
    409,
    'Worker lease was superseded.',
  );
}
async function executionGrant(job: jobs): Promise<RunGrant> {
  return prisma.$transaction(async (db) => {
    await lockProject(db, job.project_id);
    await assertJob(db, job);
    const r = job.run_id
      ? await db.runs.findFirst({
          where: { id: job.run_id, claims: { released_at: null } },
          include: { claims: { include: { tasks: true, users: true } } },
        })
      : null;
    requireThat(
      r && r.generation === r.claims.tasks.generation && !r.stopped_at,
      409,
      'Stale execution generation.',
    );
    const actor = r.claims.users;
    await access(db, actor, job.project_id, 'contribute');
    const manifest = r.manifest as unknown as RunGrant['config'] & { connectionId: string };
    requireThat(
      await db.provider_connections.count({
        where: {
          id: manifest.connectionId,
          user_id: actor.id,
          project_id: job.project_id,
          enabled: true,
        },
      }),
      403,
      'AI account access has been revoked.',
    );
    const comments = await db.comments.findMany({
      where: { task_id: job.task_id },
      orderBy: { created_at: 'asc' },
      select: { body: true },
    });
    await db.runs.update({
      where: { id: r.id },
      data: { state: 'running', heartbeat_at: new Date() },
    });
    return {
      operationId: job.id,
      runId: r.id,
      taskId: job.task_id,
      projectId: job.project_id,
      orgId: job.org_id,
      generation: r.generation,
      outcome: r.claims.tasks.outcome,
      criteria: r.claims.tasks.criteria as string[],
      feedback: comments.map((x) => x.body),
      config: manifest,
    };
  });
}
async function finishRun(job: jobs, grant: RunGrant, result: RunResult) {
  return prisma.$transaction(async (db) => {
    await lockProject(db, job.project_id);
    await assertJob(db, job);
    await lockRow(db, 'tasks', job.task_id);
    const t = await db.tasks.findUniqueOrThrow({ where: { id: job.task_id } });
    const m = result.manifest;
    requireThat(
      t.generation === grant.generation &&
        m.generation === t.generation &&
        m.runId === grant.runId &&
        m.taskId === t.id &&
        m.projectId === t.project_id &&
        m.orgId === t.org_id,
      409,
      'Rejecting a stale or mis-scoped result.',
    );
    requireThat(
      m.repository === grant.config.repository &&
        m.baseSha === grant.config.baseSha &&
        m.targetRef === grant.config.targetRef &&
        m.fixture === (grant.config.mode === 'fixture'),
      409,
      'Execution result does not match its grant.',
    );
    requireThat(
      result.stopProof && result.evidence.snapshotDigest === m.artifactDigest,
      409,
      'Snapshot evidence and confirmed execution stop are required.',
    );
    requireThat(
      /^[a-f0-9]{40}$/.test(m.headSha) && /^[a-f0-9]{64}$/.test(m.artifactDigest),
      409,
      'Invalid immutable artifact identity.',
    );
    const candidateId = id();
    await db.candidates.create({
      data: {
        id: candidateId,
        org_id: t.org_id,
        project_id: t.project_id,
        task_id: t.id,
        run_id: grant.runId,
        generation: t.generation,
        digest: digest(m),
        manifest: json(m),
        evidence: json(result.evidence),
      },
    });
    await db.runs.updateMany({
      where: { id: grant.runId, stopped_at: null },
      data: { state: 'stopped', stopped_at: new Date(), stop_proof: result.stopProof },
    });
    const passed =
      result.evidence.checks.length === grant.criteria.length &&
      result.evidence.checks.every((x, i) => x.status === 'passed' && x.name === grant.criteria[i]);
    await db.tasks.update({
      where: { id: t.id },
      data: {
        candidate_id: candidateId,
        state: passed ? 'review' : 'blocked',
        version: { increment: 1 },
      },
    });
    await db.jobs.update({
      where: { id: job.id },
      data: { state: 'done', lease_until: null, error: null },
    });
    await event(
      db,
      t.project_id,
      t.id,
      null,
      passed ? 'Ready for your review' : 'Acceptance checks need attention',
      { candidateId, fixture: m.fixture },
    );
  });
}
async function publicationGrant(job: jobs, reconcile = false): Promise<PublicationGrant> {
  return prisma.$transaction(async (db) => {
    await lockProject(db, job.project_id);
    await assertJob(db, job);
    const a = job.approval_id
      ? await db.approvals.findUnique({
          where: { id: job.approval_id },
          include: { candidates: true, users: true },
        })
      : null;
    await lockRow(db, 'tasks', job.task_id);
    const t = await db.tasks.findUniqueOrThrow({ where: { id: job.task_id } });
    requireThat(
      a &&
        a.action === job.kind &&
        a.task_id === job.task_id &&
        a.project_id === job.project_id &&
        a.org_id === job.org_id &&
        (job.kind === 'publish' || job.kind === 'merge'),
      409,
      'Publication intent does not match approval.',
    );
    const c = a.candidates;
    requireThat(
      t.candidate_id === c.id &&
        t.generation === c.generation &&
        a.digest === c.digest &&
        digest(c.manifest) === c.digest,
      409,
      'Approval no longer matches the current immutable candidate.',
    );
    requireThat(
      await db.claims.count({ where: { task_id: t.id, released_at: null } }),
      409,
      'The task is no longer owned.',
    );
    // Reconciliation may record an already-completed external write after expiry/revocation.
    // Every new external write still requires a currently valid approval.
    if (!reconcile) {
      await access(db, a.users, job.project_id, job.kind === 'merge' ? 'merge' : 'review');
      requireThat(
        !a.revoked_at && a.expires_at > new Date() && a.policy_version === 'v1',
        403,
        'Approval expired or was revoked.',
      );
      await db.approvals.updateMany({
        where: { id: a.id, consumed_at: null },
        data: { consumed_at: new Date() },
      });
    }
    const candidate = c.manifest as unknown as CandidateManifest;
    const pub = await db.publications.findFirst({ where: { candidate_id: c.id } });
    return {
      operationId: job.id,
      candidate,
      digest: c.digest,
      action: job.kind,
      publication: pub
        ? {
            prNumber: pub.pr_number,
            url: pub.url,
            headSha: pub.head_sha,
            repository: candidate.repository,
            targetRef: candidate.targetRef,
            branch: candidate.branch,
          }
        : undefined,
    };
  });
}
async function finishPublication(
  job: jobs,
  g: PublicationGrant,
  result: PublicationResult | MergeResult,
) {
  return prisma.$transaction(async (db) => {
    await lockProject(db, job.project_id);
    await assertJob(db, job);
    await lockRow(db, 'tasks', job.task_id);
    const t = await db.tasks.findUniqueOrThrow({ where: { id: job.task_id } });
    requireThat(
      t.generation === g.candidate.generation && t.candidate_id,
      409,
      'Stale publication generation.',
    );
    requireThat(
      result.headSha === g.candidate.headSha &&
        result.repository === g.candidate.repository &&
        result.targetRef === g.candidate.targetRef &&
        result.branch === g.candidate.branch,
      409,
      'Repository facts do not match the approved changes.',
    );
    if (job.kind === 'publish') {
      await db.publications.createMany({
        data: [
          {
            operation_id: job.id,
            org_id: t.org_id,
            project_id: t.project_id,
            task_id: t.id,
            candidate_id: t.candidate_id,
            pr_number: result.prNumber,
            url: result.url,
            head_sha: result.headSha,
          },
        ],
        skipDuplicates: true,
      });
      await db.tasks.update({
        where: { id: t.id },
        data: { state: 'code_review', version: { increment: 1 } },
      });
    } else {
      const merged = result as MergeResult;
      requireThat(
        g.publication &&
          merged.prNumber === g.publication.prNumber &&
          merged.merged &&
          merged.requiredChecksPassed &&
          merged.mergeSha &&
          /^[a-f0-9]{40}$/.test(merged.mergeSha),
        409,
        'A separately authorised, verified merge with required checks is needed for completion.',
      );
      await db.publications.updateMany({
        where: { candidate_id: t.candidate_id },
        data: { merged_sha: merged.mergeSha },
      });
      await db.tasks.update({
        where: { id: t.id },
        data: {
          state: 'completed',
          merged_sha: merged.mergeSha,
          completed_at: new Date(),
          version: { increment: 1 },
        },
      });
      await db.claims.updateMany({
        where: { task_id: t.id, released_at: null },
        data: { released_at: new Date() },
      });
    }
    await db.jobs.update({
      where: { id: job.id },
      data: { state: 'done', lease_until: null, error: null },
    });
    await event(
      db,
      t.project_id,
      t.id,
      null,
      job.kind === 'publish' ? 'Pull request verified' : 'Merge verified',
      { fixture: g.candidate.fixture, operationId: job.id },
    );
  });
}
async function failure(job: jobs, error: unknown) {
  const setup = error instanceof SetupRequired;
  const blocked = setup || job.attempts >= 5 || error instanceof Fault;
  const message = error instanceof Error ? error.message : 'External outcome is uncertain.';
  await prisma.$transaction(async (db) => {
    await lockProject(db, job.project_id);
    await lockRow(db, 'jobs', job.id);
    if (
      !(await db.jobs.count({
        where: { id: job.id, lease_token: job.lease_token, state: 'processing' },
      }))
    )
      return;
    await db.jobs.update({
      where: { id: job.id },
      data: {
        state: blocked ? 'blocked' : 'uncertain',
        error: message.slice(0, 500),
        available_at: new Date(Date.now() + 10_000),
        lease_until: null,
      },
    });
    const task = await db.tasks.findUniqueOrThrow({ where: { id: job.task_id } });
    const currentRun = job.run_id
      ? await db.runs.count({
          where: { id: job.run_id, task_id: task.id, generation: task.generation },
        })
      : 0;
    const currentApproval =
      job.approval_id && task.candidate_id
        ? await db.approvals.count({
            where: {
              id: job.approval_id,
              candidate_id: task.candidate_id,
              candidates: { generation: task.generation },
            },
          })
        : 0;
    // A stale worker can record its own failure without changing a newer generation.
    if (!currentRun && !currentApproval) {
      await db.jobs.update({ where: { id: job.id }, data: { state: 'blocked' } });
      return;
    }
    if (job.run_id)
      await db.runs.updateMany({
        where: { id: job.run_id, stopped_at: null },
        data: { state: 'unknown' },
      });
    await db.tasks.updateMany({
      where: { id: job.task_id, state: { not: 'completed' } },
      data: { state: 'blocked', version: { increment: 1 } },
    });
    await event(
      db,
      job.project_id,
      job.task_id,
      null,
      setup ? 'Connection setup required' : 'Outcome uncertain; ownership retained',
      { message: message.slice(0, 500) },
    );
  });
}
export async function executeOne(backend: ExecutionBackend) {
  const job = await reserve(['execute']);
  if (!job) return false;
  try {
    const grant = await executionGrant(job);
    requireThat(
      (grant.config.mode === 'fixture') === (backend.mode === 'fixture'),
      409,
      'Fixture and managed execution cannot be mixed.',
    );
    const observation = await backend.observe(job.id);
    if (observation.state === 'unknown' || observation.state === 'running')
      throw new Uncertain('Previous execution is not confirmed stopped. Replacement is blocked.');
    const result =
      observation.state === 'finished' ? observation.result : await backend.start(grant);
    await finishRun(job, grant, result);
  } catch (e) {
    await failure(job, e);
  }
  return true;
}
export async function publishOne(backend: PublisherBackend) {
  const job = await reserve(['publish', 'merge']);
  if (!job) return false;
  try {
    let grant = await publicationGrant(job, true);
    requireThat(
      grant.candidate.fixture === (backend.mode === 'fixture'),
      409,
      'Fixture candidates cannot reach a real publisher.',
    );
    const observation = await backend.observe(grant);
    if (observation.state === 'running' || observation.state === 'unknown')
      throw new Uncertain('GitHub outcome is uncertain; reconcile before another write.');
    let result: PublicationResult | MergeResult;
    if (observation.state === 'finished') result = observation.result;
    else {
      grant = await publicationGrant(job);
      result = job.kind === 'publish' ? await backend.publish(grant) : await backend.merge(grant);
    }
    await finishPublication(job, grant, result);
  } catch (e) {
    await failure(job, e);
  }
  return true;
}
