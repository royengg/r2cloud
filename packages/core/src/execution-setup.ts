import { z } from 'zod';
import { discoverRepositorySetup, setupDetectionVersion } from '@r2cloud/adapters/repository-setup';
import { prisma, json, type DB } from '@r2cloud/database';
import { access, event, lockProject } from './project-context';
import { projectAdministrator } from './team';
import { digest } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { executionProfile } from '@r2cloud/contracts/execution';
export { executionProfile } from '@r2cloud/contracts/execution';
export async function readExecutionSetup(actor: Actor, projectId: string) {
  const project = await access(prisma, actor, projectId);
  const [profile, connection, subscription, runtime] = await Promise.all([
    prisma.execution_profiles.findUnique({
      where: { project_id: projectId },
      select: { version: true, config: true, updated_at: true },
    }),
    prisma.provider_connections.findFirst({
      where: { project_id: projectId, user_id: actor.id },
      orderBy: { enabled: 'desc' },
      select: { provider: true, mode: true, enabled: true },
    }),
    prisma.codexConnection.findFirst({
      where: { projectId, userId: actor.id },
      orderBy: { createdAt: 'desc' },
      select: { state: true },
    }),
    prisma.executionRuntime.findFirst({
      where: { projectId, expiresAt: { gt: new Date() } },
    }),
  ]);
  return {
    repositoryConnected: !!project.repo_id,
    profile: profile
      ? {
          ...profile,
          config: storedSetup(profile.config).config,
          source: storedSetup(profile.config).source,
        }
      : null,
    provider: connection,
    sandbox: { provider: 'vercel', status: runtime ? 'available' : 'worker_unavailable' },
    subscription: {
      method: 'codex_app_server_device_code',
      scope: 'personal_project',
      status: subscription?.state ?? 'not_connected',
    },
    ready: Boolean(
      runtime && project.repo_id && subscription?.state === 'connected' && connection?.enabled,
    ),
  };
}
export async function saveExecutionSetup(
  actor: Actor,
  projectId: string,
  key: string,
  input: unknown,
) {
  const parsed = z
    .object({ version: z.number().int().min(0), config: executionProfile })
    .strict()
    .parse(input);
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  return prisma.$transaction(async (db) => {
    await lockProject(db, projectId);
    const project = await projectAdministrator(db, actor, projectId);
    requireThat(project.repo_id, 409, 'Connect a repository before configuring execution.');
    const payloadHash = digest({ action: 'execution-setup', ...parsed });
    const prior = await db.receipts.findUnique({
      where: { user_id_project_id_key: { user_id: actor.id, project_id: projectId, key } },
    });
    if (prior) {
      requireThat(
        prior.payload_hash === payloadHash,
        409,
        'Command key was used with different content.',
      );
      return prior.response;
    }
    const previous = await db.execution_profiles.findUnique({
      where: { project_id: projectId },
      select: { version: true },
    });
    requireThat(
      (previous?.version ?? 0) === parsed.version,
      409,
      'Execution setup changed. Reload before saving.',
    );
    const version = parsed.version + 1;
    await db.execution_profiles.upsert({
      where: { project_id: projectId },
      create: {
        project_id: projectId,
        org_id: project.org_id,
        version,
        config: json(parsed.config),
        updated_by: actor.id,
      },
      update: {
        version,
        config: json(parsed.config),
        updated_by: actor.id,
        updated_at: new Date(),
      },
    });
    await event(db, projectId, null, actor.id, 'Execution setup updated', {
      version,
      digest: digest(parsed.config),
    });
    const result = { version };
    await db.receipts.create({
      data: {
        user_id: actor.id,
        project_id: projectId,
        key,
        payload_hash: payloadHash,
        response: result,
      },
    });
    return result;
  });
}
/** Called while the task's authoritative project lock is held. Never runs commands. */
export async function pinExecutionSetup(
  db: DB,
  projectId: string,
  minutes: number,
  budgetCents: number,
) {
  const profile = await db.execution_profiles.findUnique({
    where: { project_id: projectId },
    select: { version: true, config: true },
  });
  requireThat(
    profile,
    409,
    'Prepare repository setup through repository_setup before starting work.',
  );
  const stored = storedSetup(profile.config);
  if (stored.source === 'automatic') {
    const project = await db.projects.findUniqueOrThrow({
      where: { id: projectId },
      select: { repositories: { select: { full_name: true, base_sha: true } } },
    });
    requireThat(
      project.repositories?.full_name === stored.repository &&
        project.repositories.base_sha === stored.baseSha &&
        stored.detector === setupDetectionVersion,
      409,
      'Repository setup needs to be detected again before starting work.',
    );
  }
  const config = stored.config;
  requireThat(
    minutes <= config.maxMinutes && budgetCents <= config.maxBudgetCents,
    409,
    'The run exceeds this project’s execution limits.',
  );
  return { version: profile.version, digest: digest(config), config };
}

const detectedSetup = z.object({
  source: z.literal('automatic'),
  repository: z.string(),
  baseSha: z.string(),
  detector: z.number(),
  config: executionProfile,
});
function storedSetup(value: unknown) {
  const detected = detectedSetup.safeParse(value);
  return detected.success
    ? detected.data
    : { source: 'manual' as const, config: executionProfile.parse(value) };
}
const discoveries = new Map<string, Promise<void>>();
export async function ensureExecutionSetup(actor: Actor, projectId: string, directory?: string) {
  const project = await access(prisma, actor, projectId, 'contribute');
  requireThat(project.repo_id, 409, 'Connect a repository before preparing execution.');
  const [repository, previous] = await Promise.all([
    prisma.repositories.findUniqueOrThrow({ where: { id: project.repo_id } }),
    prisma.execution_profiles.findUnique({ where: { project_id: projectId } }),
  ]);
  const current = previous && storedSetup(previous.config);
  if (
    current &&
    (current.source === 'manual' ||
      (current.repository === repository.full_name &&
        current.baseSha === repository.base_sha &&
        current.detector === setupDetectionVersion &&
        (!directory || current.config.directory === directory)))
  )
    return;
  const key = `${projectId}:${repository.id}:${repository.base_sha}:${directory ?? ''}`;
  const pending = discoveries.get(key);
  if (pending) return pending;
  const discovery = (async () => {
    const config = await discoverRepositorySetup(
      repository.full_name,
      repository.base_sha,
      directory,
    );
    await prisma.$transaction(async (db) => {
      await lockProject(db, projectId);
      const latest = await access(db, actor, projectId, 'contribute');
      requireThat(
        latest.repo_id === repository.id,
        409,
        'The connected repository changed. Retry setup.',
      );
      const repo = await db.repositories.findUniqueOrThrow({ where: { id: repository.id } });
      requireThat(
        repo.base_sha === repository.base_sha,
        409,
        'The repository revision changed. Retry setup.',
      );
      const existing = await db.execution_profiles.findUnique({ where: { project_id: projectId } });
      if ((existing?.version ?? 0) !== (previous?.version ?? 0)) return;
      const version = (previous?.version ?? 0) + 1;
      const value = {
        source: 'automatic',
        repository: repository.full_name,
        baseSha: repository.base_sha,
        detector: setupDetectionVersion,
        config,
      };
      await db.execution_profiles.upsert({
        where: { project_id: projectId },
        create: {
          project_id: projectId,
          org_id: project.org_id,
          version,
          config: json(value),
          updated_by: actor.id,
        },
        update: { version, config: json(value), updated_by: actor.id, updated_at: new Date() },
      });
      await event(db, projectId, null, actor.id, 'Repository setup detected', {
        version,
        directory: config.directory,
      });
    });
  })();
  discoveries.set(key, discovery);
  try {
    await discovery;
  } finally {
    discoveries.delete(key);
  }
}
