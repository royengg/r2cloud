import { z } from 'zod';
import { prisma, json, type DB } from '@r2cloud/database';
import { access, event, lockProject } from './project-context';
import { projectAdministrator } from './team';
import { digest } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { executionProfile } from '@r2cloud/contracts/execution';
export { executionProfile } from '@r2cloud/contracts/execution';
export async function readExecutionSetup(actor: Actor, projectId: string) {
  const project = await access(prisma, actor, projectId);
  const profile = await prisma.execution_profiles.findUnique({
    where: { project_id: projectId },
    select: { version: true, config: true, updated_at: true },
  });
  const connection = await prisma.provider_connections.findFirst({
    where: { project_id: projectId, user_id: actor.id },
    orderBy: { enabled: 'desc' },
    select: { provider: true, mode: true, enabled: true },
  });
  const subscription = await prisma.codexConnection.findFirst({
    where: { projectId, userId: actor.id },
    orderBy: { createdAt: 'desc' },
    select: { state: true },
  });
  const runtime = await prisma.executionRuntime.findFirst({
    where: { projectId, expiresAt: { gt: new Date() } },
  });
  return {
    repositoryConnected: !!project.repo_id,
    profile,
    provider: connection,
    sandbox: { provider: 'vercel', status: runtime ? 'available' : 'worker_unavailable' },
    subscription: {
      method: 'codex_app_server_device_code',
      scope: 'personal_project',
      status: subscription?.state ?? 'not_connected',
    },
    ready: Boolean(
      runtime &&
      profile &&
      project.repo_id &&
      subscription?.state === 'connected' &&
      connection?.enabled,
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
  requireThat(profile, 409, 'Configure repository setup and sandbox limits before starting work.');
  const config = executionProfile.parse(profile.config);
  requireThat(
    minutes <= config.maxMinutes && budgetCents <= config.maxBudgetCents,
    409,
    'The run exceeds this project’s execution limits.',
  );
  return { version: profile.version, digest: digest(config), config };
}
