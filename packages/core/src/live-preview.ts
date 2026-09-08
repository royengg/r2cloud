import { randomBytes, randomUUID } from 'node:crypto';
import { prisma, type DB } from '@r2cloud/database';
import { hash } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { access } from './project-context';

const secret = () => randomBytes(32).toString('base64url');

async function available(db: DB, previewId: string) {
  const preview = await db.livePreview.findUnique({
    where: { id: previewId },
    include: { runtime: true },
  });
  const runtime = preview?.runtime;
  requireThat(
    preview &&
      runtime &&
      preview.state === 'ready' &&
      !runtime.stoppedAt &&
      ['active', 'idle'].includes(runtime.state) &&
      runtime.expiresAt.getTime() > Date.now() &&
      runtime.heartbeatAt.getTime() > Date.now() - 90000 &&
      (!runtime.idleUntil || runtime.idleUntil.getTime() > Date.now()),
    410,
    'This preview has ended.',
  );
  requireThat(
    await db.conversationThread.count({
      where: {
        id: runtime.threadId,
        projectId: runtime.projectId,
        archivedAt: null,
      },
    }),
    410,
    'This preview thread is archived.',
  );
  return preview;
}
async function session(db: DB, actor: Actor, sessionId: string) {
  requireThat(actor.kind === 'human', 403, 'A signed-in person must open the preview.');
  const identity = await db.authSession.findFirst({
    where: {
      id: sessionId,
      expiresAt: { gt: new Date() },
      user: { productUser: { id: actor.id } },
    },
    select: { expiresAt: true },
  });
  requireThat(identity, 401, 'Sign in again to open this preview.');
  return identity;
}
export async function readLivePreview(actor: Actor, projectId: string, threadId: string) {
  await access(prisma, actor, projectId);
  requireThat(
    await prisma.conversationThread.count({ where: { id: threadId, projectId, archivedAt: null } }),
    404,
    'Thread not found.',
  );
  const preview = await prisma.livePreview.findFirst({
    where: { runtime: { projectId, threadId } },
    orderBy: { updatedAt: 'desc' },
    include: { runtime: true },
  });
  if (!preview) return { preview: null };
  const runtime = preview.runtime;
  const expired =
    runtime.stoppedAt ||
    runtime.expiresAt.getTime() <= Date.now() ||
    runtime.heartbeatAt.getTime() <= Date.now() - 90000 ||
    (runtime.idleUntil && runtime.idleUntil.getTime() <= Date.now());
  return {
    preview: {
      id: preview.id,
      state: expired ? 'stopped' : preview.state,
      error: preview.error,
      expiresAt: (runtime.idleUntil ?? runtime.expiresAt).toISOString(),
    },
  };
}
export async function issueLivePreview(actor: Actor, projectId: string, previewId: string) {
  return prisma.$transaction(async (db) => {
    await access(db, actor, projectId);
    requireThat(actor.sessionId, 401, 'Sign in again to open this preview.');
    const identity = await session(db, actor, actor.sessionId);
    const preview = await available(db, previewId);
    requireThat(preview.runtime.projectId === projectId, 404, 'Preview not found.');
    const ticket = secret();
    await db.livePreviewGrant.create({
      data: {
        id: randomUUID(),
        previewId,
        actorId: actor.id,
        sessionId: actor.sessionId,
        ticketHash: hash(ticket),
        ticketExpiresAt: new Date(Date.now() + 60000),
        expiresAt: new Date(
          Math.min(identity.expiresAt.getTime(), preview.runtime.expiresAt.getTime()),
        ),
      },
    });
    return { ticket };
  });
}
export async function redeemLivePreview(previewId: string, ticket: string) {
  requireThat(/^[\w-]{43}$/.test(ticket), 401, 'Invalid preview ticket.');
  return prisma.$transaction(async (db) => {
    const grant = await db.livePreviewGrant.findUnique({ where: { ticketHash: hash(ticket) } });
    requireThat(
      grant &&
        grant.previewId === previewId &&
        !grant.tokenHash &&
        grant.ticketExpiresAt.getTime() > Date.now() &&
        grant.expiresAt.getTime() > Date.now(),
      401,
      'Preview ticket expired. Open it again from the thread.',
    );
    const preview = await available(db, previewId);
    const actor = { id: grant.actorId, kind: 'human' as const };
    await session(db, actor, grant.sessionId);
    await access(db, actor, preview.runtime.projectId);
    const token = secret();
    const claimed = await db.livePreviewGrant.updateMany({
      where: { id: grant.id, tokenHash: null },
      data: { tokenHash: hash(token) },
    });
    requireThat(claimed.count === 1, 401, 'Preview ticket was already used.');
    return { token, expiresAt: grant.expiresAt };
  });
}
export async function authorizeLivePreview(previewId: string, token: string) {
  requireThat(/^[\w-]{43}$/.test(token), 401, 'Open this preview from its project thread.');
  const grant = await prisma.livePreviewGrant.findUnique({ where: { tokenHash: hash(token) } });
  requireThat(
    grant && grant.previewId === previewId && grant.expiresAt.getTime() > Date.now(),
    401,
    'Preview access expired.',
  );
  const preview = await available(prisma, previewId);
  const actor = { id: grant.actorId, kind: 'human' as const };
  await session(prisma, actor, grant.sessionId);
  await access(prisma, actor, preview.runtime.projectId);
  const allocation = await prisma.sandboxAllocation.findUnique({
    where: { operationId: preview.runtimeId },
  });
  requireThat(allocation?.state === 'running', 410, 'The preview sandbox has stopped.');
  return {
    previewId,
    runtimeId: preview.runtimeId,
    sandboxName: allocation.name,
    configHash: allocation.configHash,
    port: preview.port,
    expiresAt: grant.expiresAt.getTime(),
  };
}
