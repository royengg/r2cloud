import { codexModels } from '@r2cloud/contracts/threads';
import { prisma, json } from '@r2cloud/database';
import { nextCodexConnection } from '@r2cloud/database/locking';
import { access, event, lockProject } from './project-context';
import { id } from '@r2cloud/contracts/hash';
import { requireThat } from '@r2cloud/contracts/domain';
import type { CodexLoginSession } from '@r2cloud/adapters/codex-login';
import type { CredentialVault } from '@r2cloud/adapters/credential-vault';
import { setTimeout as pause } from 'node:timers/promises';
export async function connectCodexOne(
  create: (id: string) => Promise<CodexLoginSession>,
  vault: Pick<CredentialVault, 'put' | 'remove'>,
  signal?: AbortSignal,
) {
  await prisma.codexConnection.updateMany({
    where: {
      state: { in: ['queued', 'starting', 'awaiting'] },
      OR: [{ expiresAt: { lte: new Date() } }, { leaseUntil: { lte: new Date() } }],
    },
    data: {
      state: 'failed',
      userCode: null,
      error: 'Sign-in expired or was interrupted. Try again.',
    },
  });
  for (const row of await prisma.codexConnection.findMany({
    where: { state: { in: ['failed', 'cancelled', 'disconnected'] } },
    select: { id: true },
  }))
    await vault.remove(row.id);
  const request = await prisma.$transaction(async (db) => {
    const connectionId = await nextCodexConnection(db);
    if (!connectionId) return null;
    return db.codexConnection.update({
      where: { id: connectionId },
      data: { state: 'starting', leaseToken: id(), leaseUntil: new Date(Date.now() + 90_000) },
    });
  });
  if (!request) return false;
  let session: CodexLoginSession | undefined;
  let connected = false;
  const actor = { id: request.userId };
  const current = {
    id: request.id,
    leaseToken: request.leaseToken,
    state: { in: ['starting', 'awaiting'] },
    expiresAt: { gt: new Date() },
  };
  try {
    await access(prisma, actor, request.projectId, 'contribute');
    signal?.throwIfAborted();
    session = await create(request.id);
    const login = await session.start();
    const updated = await prisma.codexConnection.updateMany({
      where: { ...current, expiresAt: { gt: new Date() }, leaseUntil: { gt: new Date() } },
      data: {
        state: 'awaiting',
        loginId: login.loginId,
        userCode: login.userCode,
        leaseUntil: new Date(Date.now() + 90_000),
      },
    });
    requireThat(updated.count, 409, 'Sign-in was cancelled or expired.');
    while (!session.completed(login.loginId)) {
      await pause(1000, undefined, { signal });
      await access(prisma, actor, request.projectId, 'contribute');
      const alive = await prisma.codexConnection.updateMany({
        where: { ...current, expiresAt: { gt: new Date() }, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + 90_000) },
      });
      requireThat(alive.count, 409, 'Sign-in was cancelled or expired.');
    }
    const credentials = await session.credentials();
    try {
      await vault.put(request.id, credentials.auth);
    } finally {
      credentials.auth.fill(0);
    }
    await prisma.$transaction(async (db) => {
      await lockProject(db, request.projectId);
      await access(db, actor, request.projectId, 'contribute');
      const saved = await db.codexConnection.updateMany({
        where: { ...current, expiresAt: { gt: new Date() }, leaseUntil: { gt: new Date() } },
        data: {
          state: 'connected',
          userCode: null,
          loginId: null,
          leaseUntil: null,
          plan: credentials.plan,
        },
      });
      requireThat(saved.count, 409, 'Sign-in was cancelled or expired.');
      await db.provider_connections.create({
        data: {
          id: request.id,
          org_id: request.orgId,
          project_id: request.projectId,
          user_id: request.userId,
          provider: 'codex',
          mode: 'managed',
          secret_ref: request.id,
          enabled: false,
        },
      });
      await event(db, request.projectId, null, request.userId, 'Personal Codex account linked');
    });
    connected = true;
  } catch {
    await prisma.codexConnection.updateMany({
      where: {
        id: request.id,
        leaseToken: request.leaseToken,
        state: { in: ['starting', 'awaiting'] },
      },
      data: {
        state: 'failed',
        userCode: null,
        loginId: null,
        error: 'Codex sign-in could not be completed. Try again.',
      },
    });
  } finally {
    try {
      await session?.close();
    } finally {
      if (!connected) {
        const final = await prisma.codexConnection.findUnique({
          where: { id: request.id },
          select: { state: true },
        });
        if (final?.state !== 'connected') await vault.remove(request.id);
      }
    }
  }
  return true;
}

export async function refreshCodexModels(
  read: (auth: Buffer) => Promise<unknown>,
  vault: Pick<CredentialVault, 'read'>,
) {
  const connection = await prisma.codexConnection.findFirst({
    where: {
      state: 'connected',
      OR: [{ modelsUpdatedAt: null }, { modelsUpdatedAt: { lt: new Date(Date.now() - 3600000) } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!connection) return;
  await access(prisma, { id: connection.userId }, connection.projectId, 'contribute');
  const auth = await vault.read(connection.id);
  try {
    const models = codexModels.parse(await read(auth));
    await prisma.codexConnection.updateMany({
      where: { id: connection.id, state: 'connected' },
      data: { models: json(models), modelsUpdatedAt: new Date() },
    });
  } finally {
    auth.fill(0);
  }
}
