import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma, json } from '@r2cloud/database';
import { nextRepositoryConnection } from '@r2cloud/database/locking';
import { access, event, lockProject } from './project-context';
import { projectAdministrator } from './team';
import { id, hash, digest } from '@r2cloud/contracts/hash';
import { requireThat, Fault, type Actor } from '@r2cloud/contracts/domain';
import type { RepositoryDiscovery, DiscoveredRepository } from '@r2cloud/contracts/adapters';
export type ConnectionConfig = { clientId: string; callbackURL: string; appSlug: string };
export async function connectionStatus(actor: Actor, projectId: string, config?: ConnectionConfig) {
  const project = await access(prisma, actor, projectId);
  const repository = project.repo_id
    ? await prisma.repositories.findUnique({
        where: { id: project.repo_id },
        select: { full_name: true, target_ref: true },
      })
    : null;
  let manage = false;
  try {
    await projectAdministrator(prisma, actor, projectId);
    manage = true;
  } catch (error) {
    if (!(error instanceof Fault) || error.status !== 403) throw error;
  }
  const row = manage
    ? await prisma.repositoryConnection.findFirst({
        where: { projectId, actorId: actor.id },
        orderBy: { createdAt: 'desc' },
      })
    : null;
  const pending = row
    ? {
        id: row.id,
        status: row.status,
        repositories: row.repositories,
        error: row.error,
        expires_at: row.expiresAt,
      }
    : null;
  if (pending && pending.expires_at <= new Date() && pending.status !== 'attached') {
    pending.status = 'failed';
    pending.repositories = null;
    pending.error = 'Authorization expired. Reconnect GitHub.';
  }
  return {
    repository,
    manage,
    githubAvailable: Boolean(config),
    installationURL: config ? `https://github.com/apps/${config.appSlug}/installations/new` : null,
    pending,
  };
}
export async function beginRepositoryConnection(
  actor: Actor,
  projectId: string,
  key: string,
  config?: ConnectionConfig,
) {
  requireThat(config, 503, 'GitHub repository connections are not configured yet.');
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  const state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackURL,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return prisma.$transaction(async (db) => {
    await lockProject(db, projectId);
    const project = await projectAdministrator(db, actor, projectId);
    const payloadHash = digest({ action: 'repository-authorization', config });
    const previous = await db.receipts.findUnique({
      where: { user_id_project_id_key: { user_id: actor.id, project_id: projectId, key } },
    });
    if (previous) {
      requireThat(
        previous.payload_hash === payloadHash,
        409,
        'Command key was used with different content.',
      );
      return previous.response as { url: string };
    }
    requireThat(!project.repo_id, 409, 'This project already has a repository.');
    await db.repositoryConnection.create({
      data: {
        id: id(),
        orgId: project.org_id,
        projectId,
        actorId: actor.id,
        stateHash: hash(state),
        verifier,
        status: 'authorizing',
      },
    });
    const result = { url: url.href };
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
export async function queueRepositoryCallback(actor: Actor, state: string, code: string) {
  requireThat(
    state.length >= 32 && state.length <= 128 && code.length > 0 && code.length <= 512,
    400,
    'Invalid repository authorization callback.',
  );
  return prisma.$transaction(async (db) => {
    const row = await db.repositoryConnection.findUnique({ where: { stateHash: hash(state) } });
    requireThat(
      row?.actorId === actor.id,
      403,
      'This repository authorization belongs to another session.',
    );
    await lockProject(db, row.projectId);
    await projectAdministrator(db, actor, row.projectId);
    const updated = await db.repositoryConnection.updateMany({
      where: { id: row.id, status: 'authorizing', expiresAt: { gt: new Date() } },
      data: { status: 'queued', code },
    });
    requireThat(updated.count, 409, 'This repository authorization expired or was already used.');
    return { projectId: row.projectId };
  });
}
export async function discoverOne(backend: RepositoryDiscovery) {
  const request = await prisma.$transaction(async (db) => {
    await db.repositoryConnection.updateMany({
      where: { status: { in: ['authorizing', 'queued'] }, expiresAt: { lte: new Date() } },
      data: {
        status: 'failed',
        code: null,
        verifier: null,
        error: 'Authorization expired. Reconnect GitHub.',
      },
    });
    await db.repositoryConnection.updateMany({
      where: { status: 'checking', leaseUntil: { lt: new Date() } },
      data: {
        status: 'failed',
        code: null,
        verifier: null,
        error: 'Authorization was interrupted. Reconnect GitHub.',
      },
    });
    const id = await nextRepositoryConnection(db);
    if (!id) return null;
    const row = await db.repositoryConnection.findUniqueOrThrow({ where: { id } });
    await db.repositoryConnection.update({
      where: { id },
      data: {
        status: 'checking',
        leaseUntil: new Date(Date.now() + 8 * 60_000),
        code: null,
        verifier: null,
      },
    });
    return row;
  });
  if (!request) return false;
  try {
    const actor = { id: request.actorId, kind: 'human' as const };
    await projectAdministrator(prisma, actor, request.projectId);
    const account = await prisma.authAccount.findFirst({
      where: { providerId: 'github', user: { productUser: { id: actor.id } } },
      select: { accountId: true },
    });
    requireThat(account, 403, 'A verified GitHub identity is required.');
    requireThat(request.code && request.verifier, 409, 'Repository authorization is incomplete.');
    const repositories = await backend.discover({
      code: request.code,
      verifier: request.verifier,
      githubUserId: account.accountId,
    });
    await prisma.$transaction(async (db) => {
      await lockProject(db, request.projectId);
      await projectAdministrator(db, actor, request.projectId);
      const updated = await db.repositoryConnection.updateMany({
        where: { id: request.id, status: 'checking', leaseUntil: { gt: new Date() } },
        data: {
          status: 'ready',
          repositories: json(repositories),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      requireThat(updated.count, 409, 'Repository discovery was superseded.');
      await event(db, request.projectId, null, actor.id, 'Repository choices verified');
    });
  } catch {
    await prisma.repositoryConnection.updateMany({
      where: { id: request.id, status: 'checking' },
      data: {
        status: 'failed',
        error:
          'Repository access could not be verified. Reconnect GitHub and use the same account you signed in with.',
      },
    });
  }
  return true;
}
export async function attachRepository(actor: Actor, projectId: string, raw: unknown) {
  const input = z
    .object({ connectionId: z.string().min(1), repositoryId: z.number().int().positive() })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (db) => {
    await lockProject(db, projectId);
    const project = await projectAdministrator(db, actor, projectId);
    const connection = await db.repositoryConnection.findFirst({
      where: { id: input.connectionId, projectId, actorId: actor.id },
    });
    requireThat(connection, 403, 'Repository choices are not available to this account.');
    if (connection.status === 'attached') {
      const existing = project.repo_id
        ? await db.repositories.findUnique({
            where: { id: project.repo_id },
            select: { github_id: true },
          })
        : null;
      requireThat(
        String(existing?.github_id) === String(input.repositoryId),
        409,
        'A different repository is already connected.',
      );
      return { connected: true };
    }
    requireThat(
      connection.status === 'ready' && connection.expiresAt > new Date(),
      409,
      'Repository choices expired. Reconnect GitHub.',
    );
    requireThat(!project.repo_id, 409, 'This project already has a repository.');
    const repository = (connection.repositories as unknown as DiscoveredRepository[]).find(
      (r) => r.id === input.repositoryId,
    );
    requireThat(repository, 403, 'Select a repository verified for your GitHub account.');
    let saved = await db.repositories.findFirst({
      where: { org_id: project.org_id, github_id: repository.id },
    });
    if (!saved)
      saved = await db.repositories.create({
        data: {
          id: id(),
          org_id: project.org_id,
          full_name: repository.fullName,
          target_ref: repository.defaultBranch,
          base_sha: repository.baseSha,
          github_id: repository.id,
          installation_id: repository.installationId,
        },
      });
    await db.projects.update({ where: { id: projectId }, data: { repo_id: saved.id } });
    await db.repositoryConnection.update({
      where: { id: connection.id },
      data: { status: 'attached' },
    });
    await event(db, projectId, null, actor.id, 'Repository connected', {
      repository: repository.fullName,
      baseSha: repository.baseSha,
    });
    return { connected: true };
  });
}
